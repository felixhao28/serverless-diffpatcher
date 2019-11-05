// @ts-check
const fs = require("fs-extra");
const path = require("path");
const semver = require("semver");
const XXHash = require('xxhash');
const webdownload = require('download');
const asyncPool = require("tiny-async-pool");
const bsdiff = require("bsdiff-nodejs");

/**
 * @typedef {Object<string, number>} FileProgressLite
 * @property {number} percent
 * @property {number} transferred
 * @property {number} total
 */

/**
 * @typedef {Object<string, number>} FileProgress
 * @property {string} name
 * @property {number} percent
 * @property {number} transferred
 * @property {number} total
 */

/**
 * @typedef {Object<string, any>} DownloadProgress
 * @property {FileProgress[]} [downloadProgresses]
 * @property {number} filesDownloaded
 * @property {number} totalFiles
 */

/**
 * @enum {number}
 */
const UpdateStatus = {
    READ_LOCAL_VERSION: 0,
    FETCH_REMOTE_VERSION: 1,
    FETCH_MANIFEST: 2,
    VERIFY_LOCAL_FILES: 3,
    DOWNLOAD_PATCH: 4,
    PATCH_FILE: 5,
};
const nStatus = 6;

const localization = {
    STATUS_FETCH_REMOTE_VERSION: {
        en: "Fetching remote version",
        zh: "获取远端本版",
    },
    STATUS_READ_LOCAL_VERSION: {
        en: "Reading local version",
        zh: "读取本地版本",
    },
    STATUS_FETCH_MANIFEST: {
        en: "Fetching manifest",
        zh: "获取远端文件列表",
    },
    STATUS_VERIFY_LOCAL_FILES: {
        en: "Verifying local files",
        zh: "校验本地文件",
    },
    STATUS_DOWNLOAD_PATCH: {
        en: "Downloading patches",
        zh: "下载更新",
    },
    STATUS_PATCH_FILE: {
        en: "Patching local files",
        zh: "更新本地文件",
    },
    STATUS_UNKNOWN: {
        en: "Status unknown",
        zh: "未知状态",
    },
};

/**
 * @typedef {Object<string, any>} AsyncRetryOptions
 * @property {number} [retries]
 * @property {number} [interval]
 * @property {any} [lastThrown]
 */
/**
 * @template T
 * @param {(...args: any[]) => Promise<T>} f 
 * @param {any[]} args 
 * @returns {Promise<T>}
 */
async function retry(f, ...args) {
    return _retry(null, f, ...args);
}

/**
 * @template T
 * @param {AsyncRetryOptions} [options]
 * @param {(...args: any[]) => Promise<T>} f 
 * @param {any[]} args 
 * @returns {Promise<T>}
 */
async function _retry(options, f, ...args) {
    if (typeof options === "function") {
        f = options;
        options = {};
    }
    options = {
        retries: 5,
        interval: 100,
        ...options,
    };
    if (options.retries > 0) {
        options.retries -= 1;
        try {
            const r = await f(...args);
            return r;
        } catch (e) {
            options.lastThrown = e;
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    _retry(options, f, ...args).then(resolve, reject);
                }, options.interval);
            })
        }
    } else {
        throw options.lastThrown;
    }
}

class UpdateProgress {
    /**
     * 
     * @param {number} status 
     * @param {number} totalSteps 
     * @param {DownloadProgress} [downloadProgress] 
     */
    constructor(status, totalSteps, downloadProgress) {
        this.status = status;
        this.step = status + 1;
        this.totalSteps = totalSteps;
        this.downloadProgress = downloadProgress;
    }

    /**
     * 
     * @param {string} [lang] 
     * 
     * @returns {string}
     */
    toString(lang) {
        lang = lang || "en";
        let status;
        switch (this.status) {
            case UpdateStatus.FETCH_REMOTE_VERSION:
                status = localization.STATUS_FETCH_REMOTE_VERSION[lang];
                break;
            case UpdateStatus.READ_LOCAL_VERSION:
                status = localization.STATUS_READ_LOCAL_VERSION[lang];
                break;
            case UpdateStatus.FETCH_MANIFEST:
                status = localization.STATUS_FETCH_MANIFEST[lang];
                break;
            case UpdateStatus.VERIFY_LOCAL_FILES:
                status = localization.STATUS_VERIFY_LOCAL_FILES[lang];
                break;
            case UpdateStatus.DOWNLOAD_PATCH:
                status = localization.STATUS_DOWNLOAD_PATCH[lang];
                break;
            case UpdateStatus.PATCH_FILE:
                status = localization.STATUS_PATCH_FILE[lang];
                break;
            default:
                status = localization.STATUS_UNKNOWN[lang];
        }
        status = `(${this.step}/${this.totalSteps}) ${status}`;
        if (this.downloadProgress) {
            status += `${this.downloadProgress.filesDownloaded}/${this.downloadProgress.totalFiles}`;
            if (this.downloadProgress.downloadProgresses && this.downloadProgress.downloadProgresses.length > 0) {
                status += ' - ';
                for (let fileProgress of this.downloadProgress.downloadProgresses) {
                    status += `\n${fileProgress.name}: ${fileProgress.transferred}/${fileProgress.total} - `
                    status += fileProgress.percent.toLocaleString(undefined, { style: 'percent', minimumFractionDigits: 2 });
                }
            }
        }
        return status;
    }
}

/**
 * 
 * @param {string} uri 
 * @param {string} targetFolder
 * @param {(progress: FileProgressLite) => void} [progressListener] 
 * @returns {Promise<void>}
 */
async function downloadTo(uri, targetFolder, progressListener) {
    if (uri.startsWith("file://")) {
        uri = uri.substring("file://".length);
        await fs.copy(uri, path.join(targetFolder, path.basename(uri)));
    } else {
        let stream = webdownload(uri, targetFolder);
        if (progressListener) {
            stream = stream.on("downloadProgress", progressListener);
        }
        await stream;
    }
}

/**
 * @param {string} uri 
 * @param {(progress: FileProgressLite) => void} [progressListener] 
 * @returns {Promise<Buffer>}
 */
async function download(uri, progressListener) {
    if (uri.startsWith("file://")) {
        uri = uri.substring("file://".length);
        return fs.readFile(uri);
    } else {
        let stream = webdownload(uri);
        if (progressListener) {
            stream = stream.on("downloadProgress", progressListener);
        }
        return stream;
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
     * @returns {Promise<string | void>} newest version online
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
        return newVersion && semver.gt(newVersion, currentVersion) ? newVersion : null;
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
     * @param {(progress: UpdateProgress) => void} [progressListener]
     * @returns {Promise<PatchInfo[]>} the path to the downloaded folder containing patch files.
     */
    async fetchPatch(localPath, toVersion, progressListener) {
        progressListener = progressListener || ((_) => {});
        progressListener(new UpdateProgress(UpdateStatus.FETCH_MANIFEST, nStatus, {
            totalFiles: 1,
            filesDownloaded: 0
        }));
        const fileList = await this.fetchFileList(toVersion);
        progressListener(new UpdateProgress(UpdateStatus.FETCH_MANIFEST, nStatus, {
            totalFiles: fileList.length,
            filesDownloaded: 0
        }));
        // compare file
        /** @type {(FileInfo & {oldDigest: string})[]} */
        const downloadList = [];
        let verifiedCount = 0;
        /** @type {(fileInfo: FileInfo) => Promise<void>} */
        const verifyDigest = async(fileInfo) => {
            const digest = await calcDigest(path.join(localPath, fileInfo.path));
            if (fileInfo.digest !== digest) {
                downloadList.push({
                    oldDigest: digest,
                    ...fileInfo
                });
            }
            verifiedCount += 1;
            progressListener(new UpdateProgress(UpdateStatus.FETCH_MANIFEST, nStatus, {
                totalFiles: fileList.length,
                filesDownloaded: verifiedCount
            }));
        }
        await Promise.all(fileList.map(verifyDigest));

        /** @type {PatchInfo[]} */
        const downloadedFiles = [];
        await fs.mkdirp(this.storageFolder);
        /** @type {FileProgress[]} */
        const downloading = [];
        /** @type {(fileInfo: FileInfo & {oldDigest: string}) => Promise<void>} */
        const downloadPatch = async(fileInfo) => {
            // download patch
            const patchName = `${fileInfo.oldDigest}_${fileInfo.digest}`;
            const downloadUrl = joinAbsoluteUrlPath(this.baseUrl, "patch", patchName);
            /** @type {FileProgress} */
            const downloadStatus = {
                name: path.basename(fileInfo.path),
                percent: 0,
                total: 0,
                transferred: 0,
            };
            downloading.push(downloadStatus);
            try {
                await downloadTo(downloadUrl, this.storageFolder, (progress) => {
                    Object.assign(downloadStatus, progress);
                    progressListener(new UpdateProgress(UpdateStatus.DOWNLOAD_PATCH, nStatus, {
                        totalFiles: downloadList.length,
                        filesDownloaded: downloadedFiles.length,
                        downloadProgresses: downloading
                    }));
                });
                downloadStatus.percent = 1;
                downloadStatus.transferred = downloadStatus.total;
                progressListener(new UpdateProgress(UpdateStatus.DOWNLOAD_PATCH, nStatus, {
                    totalFiles: downloadList.length,
                    filesDownloaded: downloadedFiles.length,
                    downloadProgresses: downloading
                }));
                downloadedFiles.push({
                    file: path.join(localPath, fileInfo.path),
                    patchFile: path.join(this.storageFolder, patchName),
                    oldDigest: fileInfo.oldDigest,
                    newDigest: fileInfo.digest,
                });
            } catch (e) {
                downloadedFiles.push({
                    file: path.join(localPath, fileInfo.path),
                    patchFile: "",
                    oldDigest: "",
                    newDigest: fileInfo.digest,
                });
            }
            const index = downloading.indexOf(downloadStatus);
            if (index >= 0) {
                downloading.splice(index, 1);
            }
            progressListener(new UpdateProgress(UpdateStatus.DOWNLOAD_PATCH, nStatus, {
                totalFiles: downloadList.length,
                filesDownloaded: downloadedFiles.length,
                downloadProgresses: downloading
            }));
        }
        progressListener(new UpdateProgress(UpdateStatus.DOWNLOAD_PATCH, nStatus, {
            totalFiles: downloadList.length,
            filesDownloaded: 0
        }));
        await asyncPool(this.maxConcurrency, downloadList, downloadPatch);
        progressListener(new UpdateProgress(UpdateStatus.DOWNLOAD_PATCH, nStatus, {
            totalFiles: downloadList.length,
            filesDownloaded: downloadedFiles.length,
        }));
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
                if (patchFile.length > 0) {
                    await retry(bsdiff.patch, file, patchedFileTemp, patchFile);
                } else {

                }
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
     * Fetch newest patch files and apply them
     * 
     * @param {string} localPath the path to the local directory containing the need-to-update artifact.
     * @param {string | void} [targetVersion] the target version to update to
     * @param {(progress: UpdateProgress) => void} [progressListener]
     * @returns {Promise<string | void>} If a newer version is installed, returns the new version. Otherwise returns null.
     */
    async update(localPath, targetVersion, progressListener) {
        if (typeof targetVersion === 'function') {
            progressListener = targetVersion;
            targetVersion = undefined;
        }
        progressListener = progressListener || ((_) => {});
        progressListener(new UpdateProgress(UpdateStatus.READ_LOCAL_VERSION, nStatus));
        const localVersion = await this.getCurrentLocalVersion(localPath);
        progressListener(new UpdateProgress(UpdateStatus.FETCH_REMOTE_VERSION, nStatus));
        targetVersion = targetVersion || await this.hasNewVersion(localVersion);
        if (!targetVersion) {
            return null;
        }
        const patches = await this.fetchPatch(localPath, targetVersion, progressListener);
        progressListener(new UpdateProgress(UpdateStatus.PATCH_FILE, nStatus));
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