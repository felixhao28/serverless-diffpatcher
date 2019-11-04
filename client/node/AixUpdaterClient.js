const fs = require("fs-extra");
const path = require("path");
const semver = require("semver");
const XXHash = require('xxhash');
const webdownload = require('download');
const asyncPool = require("tiny-async-pool");
const bsdiff = require("bsdiff-nodejs");

/**
 * 
 * @param {string} uri 
 * @param {string} [targetFolder] 
 */
async function download(uri, targetFolder) {
    if (uri.startsWith("file://")) {
        uri = uri.substring("file://".length);
        if (targetFolder) {
            return fs.copy(uri, path.join(targetFolder, path.basename(uri)));
        } else {
            return fs.readFile(uri);
        }
    } else {
        return webdownload(uri, targetFolder);
    }
}

/**
 * 
 * @param {string[]} args
 * 
 * @returns {string}
 */
function joinAbsoluteUrlPath(...args) {
    let a = args.map(pathPart => pathPart.replace(/(^\/|\/$)/g, "")).join("/");
    if (args.length > 0 && args[0].indexOf("://") < 0) {
        a = "/" + a;
    }
    return a;
}

/**
 * @typedef {Object<string, string>} FileInfo
 * @property {string} path
 * @property {string} digest
 */

/**
 * @param {string} file
 * 
 * @returns {Promise<string>}
 */
async function calcDigest(file) {
    const hasher = new XXHash.Stream(0, 64);
    return new Promise((resolve, reject) => {
        fs.createReadStream(file).on("error", err => {
            reject(err);
        }).pipe(hasher).on("finish", () => {
            resolve(hasher.read().swap64().toString("hex"));
        }).on("error", err => {
            reject(err);
        });
    });
}

class AixUpdaterClient {
    /**
     * @typedef {Object<string, string>} AixUpdaterOptions
     * @property {string} baseUrl The CDN storage path
     * @property {string} artifact The internal artifact ID
     * @property {string} [storageFolder] The storage folder to save patch and backup files to.
     *                                    The folder will be created if not already exists.
     *                                    You can safely delete the folder after the update, but it will
     *                                    save time if you need to revert to a previous version.
     *                                    It creates a folder called `aixupdatercache` under current directory
     *                                    if not specified.
     * @property {number} [maxConcurrency] The max download concurrency. Default value 5.
     */

    /**
     * @typedef {Object<string, string>} PatchInfo
     * @property {string} file
     * @property {string} patchFile
     * @property {string} oldDigest
     * @property {string} newDigest
     */

    /**
     * 
     * @param {AixUpdaterOptions} options 
     */
    constructor(options) {
        this.baseUrl = joinAbsoluteUrlPath(options.baseUrl, "update", options.artifact);
        this.maxConcurrency = options.maxConcurrency || 5;
        this.storageFolder = options.storageFolder || ".aixupdatercache";
    }

    /**
     * Reads the current version of `localPath` by reading .version file
     * 
     * @param {string} localPath the path to the local directory containing the need-to-update artifact.
     * 
     * @returns {Promise<string>} current version of `localPath`
     */
    async getCurrentLocalVersion(localPath) {
        const versionFile = path.join(localPath, ".version");
        const version = await fs.promises.readFile(versionFile, "utf-8");
        return version;
    }

    /**
     * Check the newest version online
     * 
     * @returns {Promise<string>} newest version online
     */
    async getNewestRemoteVersion() {
        return (await download(joinAbsoluteUrlPath(this.baseUrl, "latest"))).toString("utf-8");
    }

    /**
     * Compares local version against the newest version online.
     * 
     * @param {string} currentVersion the current version to compare
     * @returns {Promise<string | void>} If there is a newer version available, returns the new version. Otherwise returns null.
     */
    async hasNewVersion(currentVersion) {
        const newVersion = await this.getNewestRemoteVersion();
        return semver.gt(newVersion, currentVersion) ? newVersion : null;
    }

    /**
     * 
     * @param {string} version 
     * @returns {Promise<FileInfo[]>}
     */
    async fetchFileList(version) {
        const filelistString = (await download(joinAbsoluteUrlPath(this.baseUrl, "filelist", version))).toString("utf-8");
        // fetch file list
        const fileList = [];
        for (let fileLine of filelistString.trim().split("\n")) {
            fileLine = fileLine.trim();
            if (fileLine.length > 0) {
                const [resPath, digest] = fileLine.split("\t");
                fileList.push({
                    path: resPath,
                    digest
                });
            }
        }
        return fileList;
    }

    /**
     * Download patch files to temporary folder.
     * 
     * @param {string} localPath the path to the local directory containing the need-to-update artifact.
     * @param {string} toVersion the target version to update to
     * 
     * @returns {Promise<PatchInfo[]>} the path to the downloaded folder containing patch files.
     */
    async fetchPatch(localPath, toVersion) {
        const fileList = await this.fetchFileList(toVersion);
        // compare file
        /** @type {PatchInfo[]} */
        const downloadedFiles = [];
        await fs.mkdirp(this.storageFolder);
        const downdloadPatch = async(fileInfo) => {
            const digest = await calcDigest(path.join(localPath, fileInfo.path));
            if (fileInfo.digest !== digest) {
                // download patch
                const patchName = `${digest}_${fileInfo.digest}`;
                const downloadUrl = joinAbsoluteUrlPath(this.baseUrl, "patch", patchName)
                await download(downloadUrl, this.storageFolder);
                downloadedFiles.push({
                    file: path.join(localPath, fileInfo.path),
                    patchFile: path.join(this.storageFolder, patchName),
                    oldDigest: digest,
                    newDigest: fileInfo.digest,
                });
            }
        }
        await asyncPool(this.maxConcurrency, fileList, downdloadPatch);
        return downloadedFiles;
    }

    /**
     * Apply patch files to a folder
     * 
     * @param {PatchInfo[]} patches the patche files.
     * @param {boolean} [verifyOld] check file integrity before patching
     * @param {boolean} [verifyNew] check file integrity after patching
     * 
     * @returns {Promise<void>}
     */
    async applyPatch(patches, verifyOld, verifyNew) {
        const getPatchedFileTemp = (newDigest) => {
            return path.join(this.storageFolder, newDigest);
        }
        await fs.mkdirp(this.storageFolder);
        await Promise.all(patches.map(async({ file, patchFile, oldDigest, newDigest }) => {
            if (verifyOld) {
                const verifyOldDigest = await calcDigest(file);
                if (verifyOldDigest !== oldDigest) {
                    throw new Error(`Hash does not match before patching. Expected: ${oldDigest}. Actual: ${verifyOldDigest}.`);
                }
            }
            const patchedFileTemp = getPatchedFileTemp(newDigest);
            try {
                const verifyNewDigest = await calcDigest(patchedFileTemp);
                if (verifyNewDigest !== newDigest) {
                    throw new Error(`Hash does not match on cached file. Expected: ${newDigest}. Actual: ${verifyNewDigest}.`);
                }
            } catch (e) {
                await bsdiff.patch(file, patchedFileTemp, patchFile)
                if (verifyNew) {
                    const verifyNewDigest = await calcDigest(patchedFileTemp);
                    if (verifyNewDigest !== newDigest) {
                        throw new Error(`Hash does not match after patching. Expected: ${newDigest}. Actual: ${verifyNewDigest}.`);
                    }
                }
            }
        }));
        await Promise.all(patches.map(async({ file, patchFile, oldDigest, newDigest }) => {
            const patchedFileTemp = getPatchedFileTemp(newDigest);
            await fs.promises.rename(file, getPatchedFileTemp(oldDigest));
            await fs.promises.copyFile(patchedFileTemp, file);
        }));
    }

    /**
     * Fetch newest patch files and 
     * 
     * @param {string} localPath the path to the local directory containing the need-to-update artifact.
     * @param {string} [targetVersion] the target version to update to
     * @returns {Promise<string | void>} If a newer version is installed, returns the new version. Otherwise returns null.
     */
    async update(localPath, targetVersion) {
        const localVersion = await this.getCurrentLocalVersion(localPath);
        targetVersion = targetVersion || await this.hasNewVersion(localVersion);
        if (!targetVersion) {
            return null;
        }
        const patches = await this.fetchPatch(localPath, targetVersion);
        await this.applyPatch(patches, false, false);
        return targetVersion;
    }

    /**
     * Cleans up the local storage path.
     */
    async cleanUp() {
        await fs.remove(this.storageFolder);
    }
}

module.exports = AixUpdaterClient;