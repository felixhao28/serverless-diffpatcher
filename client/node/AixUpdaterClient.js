// @ts-check
const fs = require("fs-extra");
const path = require("path");
const semver = require("semver");
const webdownload = require("download");
const asyncPool = require("tiny-async-pool");
const zipdecompress = require("decompress");
const { exec } = require("child_process");

let hasNative = false;
try {
    require("xxhash");
    hasNative = true;
} catch (e) {}
/**
 * @param {string} cmd
 */
async function execAsync(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (err) {
                err.message = (err.message || "") + "\nSTDERR: " + stderr;
                reject(err);
            } else {
                resolve(stdout);
            }
        });
    });
}

/**
 * 
 * @param {string} zipPath 
 * @param {string} targetPath 
 */
async function decompress(zipPath, targetPath) {
    try {
        await fs.remove(targetPath);
    } catch (e) {
        //ignore
    }
    if (zipPath.endsWith(".tar.gz")) {
        await execAsync(`tar zxf "${zipPath}" -C "${targetPath}"`);
    } else {
        await zipdecompress(zipPath, targetPath);
    }
}

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
    SIMPLE_READ_LOCAL_VERSION: 0,
    SIMPLE_DOWNLOAD_PATCH: 1,
    SIMPLE_PATCH_FILE: 2,
    SIMPLE_DOWNLOAD_FULL: 1,
};
const nStatus = 6;
const nSimpleStatus = 3;

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
    STATUS_SIMPLE_READ_LOCAL_VERSION: {
        en: "Reading local version",
        zh: "读取本地版本",
    },
    STATUS_SIMPLE_DOWNLOAD_PATCH: {
        en: "Downloading patches",
        zh: "下载更新",
    },
    STATUS_SIMPLE_PATCH_FILE: {
        en: "Patching local files",
        zh: "更新本地文件",
    },
    STATUS_SIMPLE_DOWNLOAD_FULL: {
        en: "Downloading full files",
        zh: "下载完整更新",
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
            });
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
            case UpdateStatus.SIMPLE_READ_LOCAL_VERSION:
                status = localization.STATUS_SIMPLE_READ_LOCAL_VERSION[lang];
                break;
            case UpdateStatus.SIMPLE_DOWNLOAD_PATCH:
                status = localization.STATUS_SIMPLE_DOWNLOAD_PATCH[lang];
                break;
            case UpdateStatus.SIMPLE_PATCH_FILE:
                status = localization.STATUS_SIMPLE_PATCH_FILE[lang];
                break;
            case UpdateStatus.SIMPLE_DOWNLOAD_FULL:
                status = localization.STATUS_SIMPLE_DOWNLOAD_FULL[lang];
                break;
            default:
                status = localization.STATUS_UNKNOWN[lang];
        }
        status = `(${this.step}/${this.totalSteps}) ${status}`;
        if (this.downloadProgress) {
            status += `${this.downloadProgress.filesDownloaded}/${this.downloadProgress.totalFiles}`;
            if (this.downloadProgress.downloadProgresses && this.downloadProgress.downloadProgresses.length > 0) {
                status += " - ";
                for (let fileProgress of this.downloadProgress.downloadProgresses) {
                    status += `\n${fileProgress.name}: ${fileProgress.transferred}/${fileProgress.total} - `;
                    status += fileProgress.percent.toLocaleString(undefined, { style: "percent", minimumFractionDigits: 2 });
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
 * @param {string} [filename]
 * @param {(progress: FileProgressLite) => void} [progressListener] 
 * @param {AiXCancellationToken} token
 * @returns {Promise<void>}
 */
async function downloadTo(uri, targetFolder, filename, progressListener, token) {
    if (typeof(filename) === "function") {
        progressListener = filename;
        filename = null;
    }
    if (token.cancelled) {
        throw new Error("cancelled");
    }
    if (uri.startsWith("file://")) {
        uri = uri.substring("file://".length);
        await fs.copy(uri, path.join(targetFolder, path.basename(uri)));
    } else {
        let stream = webdownload(uri, targetFolder, filename && {
            filename
        });
        let myReq = null;
        stream.on("request", (req) => {
            myReq = req;
        });
        token.onCancellationRequested(() => {
            stream.end();
            if (myReq) {
                myReq.abort();
            }
        });
        if (progressListener) {
            stream = stream.on("downloadProgress", progressListener);
        }
        await stream;
    }
}

/**
 * @param {string} uri 
 * @param {(progress: FileProgressLite) => void} [progressListener] 
 * @param {AiXCancellationToken} token
 * @returns {Promise<Buffer>}
 */
async function download(uri, progressListener, token) {
    if (token.cancelled) {
        throw new Error("cancelled");
    }
    if (uri.startsWith("file://")) {
        uri = uri.substring("file://".length);
        return fs.readFile(uri);
    } else {
        let stream = webdownload(uri);
        let myReq = null;
        stream.on("request", (req) => {
            myReq = req;
        });
        token.onCancellationRequested(() => {
            stream.end();
            if (myReq) {
                myReq.abort();
            }
        });
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
    const XXHash = require("xxhash");
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

/**
 * 
 * @param {string} manifestString 
 */
function parseManifest(manifestString) {
    const fileList = [];
    for (let fileLine of manifestString.trim().split("\n")) {
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
 * 
 * @param {PatchInfo[]} patches the patche files.
 * @param {boolean} verifyOld 
 * @param {boolean} verifyNew 
 * @param {AiXCancellationToken} token 
 * @param {(digest: string) => string} getPatchedFileTemp 
 */
async function applyAllPatches(patches, verifyOld, verifyNew, getPatchedFileTemp, token) {
    await Promise.all(patches.map(async({ file, patchFile, oldDigest, newDigest }) => {
        if (token.cancelled) {
            throw new Error("cancelled");
        }
        if (verifyOld && hasNative) {
            const verifyOldDigest = await calcDigest(file);
            if (verifyOldDigest !== oldDigest) {
                throw new Error(`Hash does not match before patching. Expected: ${oldDigest}. Actual: ${verifyOldDigest}.`);
            }
        }
        const patchedFileTemp = getPatchedFileTemp(newDigest);
        try {
            if (!hasNative) {
                throw "";
            }
            const verifyNewDigest = await calcDigest(patchedFileTemp);
            if (verifyNewDigest !== newDigest) {
                throw new Error(`Hash does not match on cached file. Expected: ${newDigest}. Actual: ${verifyNewDigest}.`);
            }
        } catch (e) {
            if (patchFile.length > 0) {
                if (path.basename(patchFile).match(/[A-Za-z0-9]+_[A-Za-z0-9]+\.xpatch/)) {
                    const bsdiff = require("bsdiff-nodejs");
                    await retry(bsdiff.patch, file, patchedFileTemp, patchFile);
                } else {
                    await fs.copy(patchFile, patchedFileTemp);
                }
            }
            if (verifyNew && hasNative) {
                const verifyNewDigest = await calcDigest(patchedFileTemp);
                if (verifyNewDigest !== newDigest) {
                    throw new Error(`Hash does not match after patching. Expected: ${newDigest}. Actual: ${verifyNewDigest}.`);
                }
            }
        }
    }));
    await Promise.all(patches.map(async({ file, oldDigest, newDigest }) => {
        if (token.cancelled) {
            throw new Error("cancelled");
        }
        const patchedFileTemp = getPatchedFileTemp(newDigest);
        if (oldDigest.length > 0) {
            await fs.promises.rename(file, getPatchedFileTemp(oldDigest));
        }
        await fs.promises.copyFile(patchedFileTemp, file);
    }));
}

class AiXCancellationToken {
    constructor() {
        this.cancelled = false;
        /** @type {((reason: any) => void)[]} */
        this.listeners = [];
    }

    /**
     * @param {any} reason
     */
    cancel(reason) {
        this.reason = reason;
        this.listeners.forEach((element) => element(this.reason));
    }

    /**
     * @param {(reason: any) => void} listener
     */
    onCancellationRequested(listener) {
        this.listeners.push(listener);
    }
}

/**
 * 
 * @param {string} url 
 * @param {string} targetPath 
 * @param {(p: FileProgressLite) => void} onProgress 
 * @param {(elapsed: number, transferred: number, speed: number) => void} onSpeed 
 * @param {(err?: any) => void} onErr 
 * @param {AiXCancellationToken} token 
 */
async function downloadEx(url, targetPath, onProgress, onSpeed, onErr, token) {
    let speedTestStart = 0;
    let totalP = {
        transferred: 0,
        total: 1,
    };
    const speedTester = onSpeed && setInterval(() => {
        const elapsed = speedTestStart > 0 ? Date.now() - speedTestStart : 0;
        const speed = elapsed > 0 ? totalP.transferred / (elapsed / 1000) : 0; // byte / sec
        onSpeed(elapsed, totalP.transferred, speed);
    }, 100);

    const stream = webdownload(url, targetPath, {
        timeout: 5000
    });
    let myReq = null;
    stream.on("request", (req) => {
        myReq = req;
    });
    token.onCancellationRequested((reason) => {
        stream.end();
        if (myReq) {
            myReq.abort();
        }
        onErr(reason);
    });
    stream.on("downloadProgress", (p) => {
        totalP = p;
        if (speedTestStart === 0) {
            speedTestStart = Date.now();
        }
        onProgress(p);
    });
    return stream.then((value) => {
        clearInterval(speedTester);
        if (!token.cancelled) {
            const elapsed = Date.now() - speedTestStart;
            const speed = totalP.transferred / (elapsed / 1000); // byte / sec
            onSpeed(elapsed, totalP.transferred, speed);
        }
        return value;
    }, (reason) => {
        clearInterval(speedTester);
        onErr(reason);
    });
}


/**
 * 
 * @param {string} url 
 * @param {AiXCancellationToken} cancellationToken 
 */
async function getDownloadSpeed(url, cancellationToken) {
    const tmpPath = "speedtest." + Math.random() + ".tmp";
    let testSpeed = 0;
    try {
        await downloadEx(url, tmpPath, (p) => {
            //progress
        }, (elapsed, transferred, speed) => {
            testSpeed = speed;
            if (elapsed > 3000 || transferred > 100 * 1024) {
                cancellationToken.cancel("speedLow");
            }
        }, (err) => {
            if (err === "error" || err === "speedLow") {
                // ignore
            } else {
                cancellationToken.cancel("error");
                throw err;
            }
        }, cancellationToken);
    } finally {
        await fs.remove(tmpPath);
    }
    return testSpeed;
}

class AixUpdaterClient {
    /**
     * 
     * @param {string[]} urlList 
     * @param {AiXCancellationToken} token
     */
    static async selectBestMirror(urlList, token) {
        if (urlList.length === 1) {
            return urlList[0];
        }
        const promises = urlList.map(url => getDownloadSpeed(url, token).catch(err => -1));
        const speeds = await Promise.all(promises);
        let bestI = 0;
        for (let i = 0; i < speeds.length; i++) {
            if (speeds[i] > speeds[bestI]) {
                bestI = i;
            }
        }
        // console.log(speeds);
        return speeds[bestI] > 0 ? urlList[bestI] : null;
    }

    /**
     * Patch a local folder with a simple patch
     * @param {string} localPath
     * @param {string | string[]} patchUrl
     * @param {string | string[]} fullDownloadUrl
     * @param {(progress: UpdateProgress) => void} [progressListener]
     * @param {() => Promise<void>} [beforeUpdate]
     * @param {AiXCancellationToken} [token]
     */
    static async simplePatch(localPath, patchUrl, fullDownloadUrl, progressListener, beforeUpdate, token) {
        if (typeof(patchUrl) === "string") {
            patchUrl = [patchUrl];
        }
        if (typeof(fullDownloadUrl) === "string") {
            fullDownloadUrl = [fullDownloadUrl];
        }

        progressListener = progressListener || (() => {});
        beforeUpdate = beforeUpdate || (async() => {});
        token = token || new AiXCancellationToken();
        const checkCancelled = function() {
            if (token.cancelled) {
                throw new Error("cancelled");
            }
        };

        patchUrl = await this.selectBestMirror(patchUrl, token);
        const localVersion = await AixUpdaterClient.getCurrentLocalVersion(localPath).catch(() => "0.0.0");
        if (patchUrl) {
            progressListener(new UpdateProgress(UpdateStatus.SIMPLE_READ_LOCAL_VERSION, nSimpleStatus));
            checkCancelled();

            progressListener(new UpdateProgress(UpdateStatus.SIMPLE_DOWNLOAD_PATCH, nSimpleStatus));
            const filename = patchUrl.substr(patchUrl.lastIndexOf("/") + 1);
            try {
                /** @type {FileProgress} */
                const downloadStatus = {
                    name: filename,
                    percent: 0,
                    total: 0,
                    transferred: 0,
                };
                await downloadTo(patchUrl, localPath, filename, (progress) => {
                    Object.assign(downloadStatus, progress);
                    progressListener(new UpdateProgress(UpdateStatus.SIMPLE_DOWNLOAD_PATCH, nStatus, {
                        totalFiles: 1,
                        filesDownloaded: 0,
                        downloadProgresses: [downloadStatus]
                    }));
                }, token);
                checkCancelled();
                downloadStatus.transferred == downloadStatus.total;
                downloadStatus.percent = 1;
                progressListener(new UpdateProgress(UpdateStatus.SIMPLE_DOWNLOAD_PATCH, nStatus, {
                    totalFiles: 1,
                    filesDownloaded: 0,
                    downloadProgresses: [downloadStatus]
                }));
                const patchFolder = path.join(localPath, "__" + filename + "__");
                await decompress(path.join(localPath, filename), patchFolder);

                checkCancelled();
                try {
                    const versionFileContent = await fs.readFile(path.join(patchFolder, ".update"), "utf-8");
                    const [expectedFromVersion, targetVersion] = versionFileContent.split("\t");
                    if (expectedFromVersion !== localVersion) {
                        throw new Error(`Local version ${localVersion} does not match patch applicable version ${expectedFromVersion}`);
                    }
                    const manifestContent = await fs.readFile(path.join(patchFolder, ".manifest"), "utf-8");
                    const fileList = parseManifest(manifestContent);
                    const patches = [];
                    for (const fileInfo of fileList) {
                        checkCancelled();
                        let patchPath = path.join(patchFolder, fileInfo.path);
                        try {
                            await fs.stat(patchPath);
                            patches.push({
                                file: path.join(localPath, fileInfo.path),
                                patchFile: patchPath,
                                oldDigest: "",
                                newDigest: fileInfo.digest,
                            });
                        } catch (error) {
                            if (hasNative) {
                                const digest = await calcDigest(path.join(localPath, fileInfo.path));
                                if (digest !== fileInfo.digest) {
                                    patchPath = path.join(patchFolder, digest + "_" + fileInfo.digest + ".xpatch");
                                    patches.push({
                                        file: path.join(localPath, fileInfo.path),
                                        patchFile: patchPath,
                                        oldDigest: digest,
                                        newDigest: fileInfo.digest,
                                    });
                                }
                            }
                        }
                    }
                    checkCancelled();

                    try {
                        await beforeUpdate();
                        checkCancelled();
                        progressListener(new UpdateProgress(UpdateStatus.SIMPLE_PATCH_FILE, nSimpleStatus));
                        await applyAllPatches(patches, false, true, (digest) => {
                            checkCancelled();
                            return path.join(localPath, digest) + ".tmp";
                        }, token);
                        return targetVersion;
                    } finally {
                        for (const fname of await fs.readdir(localPath)) {
                            if (fname.endsWith(".tmp")) {
                                await fs.remove(path.join(localPath, fname));
                            }
                        }
                    }
                } finally {
                    await fs.remove(patchFolder);
                }
            } catch (e) {
                // ignore
                console.error(e);
            } finally {
                await fs.remove(path.join(localPath, filename));
            }
        }

        checkCancelled();
        fullDownloadUrl = await this.selectBestMirror(fullDownloadUrl, token);
        const fullFileName = fullDownloadUrl.substring(fullDownloadUrl.lastIndexOf("/") + 1);
        /** @type {FileProgress} */
        const downloadStatus = {
            name: fullFileName,
            percent: 0,
            total: 0,
            transferred: 0,
        };
        await downloadTo(fullDownloadUrl, path.join(localPath, ".."), fullFileName, (progress) => {
            Object.assign(downloadStatus, progress);
            progressListener(new UpdateProgress(UpdateStatus.SIMPLE_DOWNLOAD_FULL, nStatus, {
                totalFiles: 1,
                filesDownloaded: 0,
                downloadProgresses: [downloadStatus]
            }));
        }, token);
        const patchFolder = path.join(localPath, "..", "__" + fullFileName + "__");
        checkCancelled();
        await decompress(path.join(localPath, "..", fullFileName), patchFolder);
        checkCancelled();
        await beforeUpdate();
        checkCancelled();
        await fs.move(localPath, path.join(localPath, "..", localVersion));
        await fs.move(patchFolder, localPath);
        return AixUpdaterClient.getCurrentLocalVersion(localPath);
    }

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
    static async getCurrentLocalVersion(localPath) {
        const versionFile = path.join(localPath, ".version");
        const version = await fs.promises.readFile(versionFile, "utf-8");
        return version;
    }

    /**
     * Check the newest version online
     * 
     * @param {AiXCancellationToken} [token]
     * @returns {Promise<string | void>} newest version online
     */
    async getNewestRemoteVersion(token) {
        token = token || new AiXCancellationToken();
        return (await download(joinAbsoluteUrlPath(this.baseUrl, "latest"), null, token)).toString("utf-8");
    }

    /**
     * Compares local version against the newest version online.
     * 
     * @param {string} currentVersion the current version to compare
     * @param {AiXCancellationToken} [token]
     * @returns {Promise<string | void>} If there is a newer version available, returns the new version. Otherwise returns null.
     */
    async hasNewVersion(currentVersion, token) {
        token = token || new AiXCancellationToken();
        const newVersion = await this.getNewestRemoteVersion(token);
        return newVersion && semver.gt(newVersion, currentVersion) ? newVersion : null;
    }

    /**
     * 
     * @param {string} version 
     * @param {AiXCancellationToken} [token]
     * @returns {Promise<FileInfo[]>}
     */
    async fetchManifest(version, token) {
        token = token || new AiXCancellationToken();
        const manifestString = (await download(joinAbsoluteUrlPath(this.baseUrl, "manifest", version), null, token)).toString("utf-8");
        // fetch file list
        const fileList = parseManifest(manifestString);
        return fileList;
    }

    /**
     * Download patch files to temporary folder.
     * 
     * @param {string} localPath the path to the local directory containing the need-to-update artifact.
     * @param {string} toVersion the target version to update to
     * @param {(progress: UpdateProgress) => void} progressListener
     * @param {AiXCancellationToken} [token]
     * @returns {Promise<PatchInfo[]>} the path to the downloaded folder containing patch files.
     */
    async fetchPatch(localPath, toVersion, progressListener, token) {
        token = token || new AiXCancellationToken();
        progressListener = progressListener || (() => {});
        progressListener(new UpdateProgress(UpdateStatus.FETCH_MANIFEST, nStatus, {
            totalFiles: 1,
            filesDownloaded: 0
        }));
        const fileList = await this.fetchManifest(toVersion, token);
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
            try {
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
            } catch (e) {
                if (e.code === "ENOENT") {
                    // new file
                    downloadList.push({
                        oldDigest: "",
                        ...fileInfo
                    });
                    return;
                }
                console.log(e);
                throw e;
            }
        };
        await Promise.all(fileList.map(verifyDigest));

        /** @type {PatchInfo[]} */
        const downloadedFiles = [];
        await fs.mkdirp(this.storageFolder);
        /** @type {FileProgress[]} */
        const downloading = [];
        /** @type {(fileInfo: FileInfo & {oldDigest: string}) => Promise<void>} */
        const downloadPatch = async(fileInfo) => {
            // download patch
            const patchName = `${fileInfo.oldDigest}_${fileInfo.digest}.xpatch`;
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
                if (fileInfo.oldDigest.length === 0) {
                    throw new Error("need to download full file");
                }
                await downloadTo(downloadUrl, this.storageFolder, null, (progress) => {
                    Object.assign(downloadStatus, progress);
                    progressListener(new UpdateProgress(UpdateStatus.DOWNLOAD_PATCH, nStatus, {
                        totalFiles: downloadList.length,
                        filesDownloaded: downloadedFiles.length,
                        downloadProgresses: downloading
                    }));
                }, token);
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
                // download full file
                const fullFileUrl = joinAbsoluteUrlPath(this.baseUrl, "files", fileInfo.digest);
                console.log("Download full file: " + fullFileUrl);
                await downloadTo(fullFileUrl, this.storageFolder, null, (progress) => {
                    Object.assign(downloadStatus, progress);
                    progressListener(new UpdateProgress(UpdateStatus.DOWNLOAD_PATCH, nStatus, {
                        totalFiles: downloadList.length,
                        filesDownloaded: downloadedFiles.length,
                        downloadProgresses: downloading
                    }));
                }, token);
                progressListener(new UpdateProgress(UpdateStatus.DOWNLOAD_PATCH, nStatus, {
                    totalFiles: downloadList.length,
                    filesDownloaded: downloadedFiles.length,
                    downloadProgresses: downloading
                }));
                downloadedFiles.push({
                    file: path.join(localPath, fileInfo.path),
                    patchFile: "",
                    oldDigest: fileInfo.oldDigest,
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
        };
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
     * @param {AiXCancellationToken} [token]
     * 
     * @returns {Promise<void>}
     */
    async applyPatch(patches, verifyOld, verifyNew, token) {
        token = token || new AiXCancellationToken();
        /**
         * @param {string} newDigest
         */
        const getPatchedFileTemp = (newDigest) => {
            return path.join(this.storageFolder, newDigest);
        };
        await fs.mkdirp(this.storageFolder);
        applyAllPatches(patches, verifyOld, verifyNew, getPatchedFileTemp, token);
    }

    /**
     * Fetch newest patch files and apply them
     * 
     * @param {string} localPath the path to the local directory containing the need-to-update artifact.
     * @param {string | void} [targetVersion] the target version to update to
     * @param {(progress: UpdateProgress) => void} [progressListener]
     * @param {AiXCancellationToken} [token]
     * @returns {Promise<string | void>} If a newer version is installed, returns the new version. Otherwise returns null.
     */
    async update(localPath, targetVersion, progressListener, token) {
        if (progressListener instanceof AiXCancellationToken) {
            token = progressListener;
            progressListener = undefined;
        }
        if (typeof targetVersion === "function") {
            progressListener = targetVersion;
            targetVersion = undefined;
        }
        token = token || new AiXCancellationToken();
        progressListener = progressListener || (() => {});
        progressListener(new UpdateProgress(UpdateStatus.READ_LOCAL_VERSION, nStatus));
        const localVersion = await AixUpdaterClient.getCurrentLocalVersion(localPath);
        progressListener(new UpdateProgress(UpdateStatus.FETCH_REMOTE_VERSION, nStatus));
        targetVersion = targetVersion || await this.hasNewVersion(localVersion, token);
        if (!targetVersion) {
            return null;
        }
        const patches = await this.fetchPatch(localPath, targetVersion, progressListener, token);
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

AixUpdaterClient.AiXCancellationToken = AiXCancellationToken;
module.exports = AixUpdaterClient;
