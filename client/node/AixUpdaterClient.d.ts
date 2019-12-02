declare namespace AixUpdaterClient {
    export interface AixUpdaterOptions {
        /**
         * The CDN storage path
         */
        baseUrl: string,
        /**
         * The internal artifact ID
         */
        artifact: string,
        /**
         * The storage folder to save patch and backup files to.
         * The folder will be created if not already exists.
         * You can safely delete the folder after the update, but it will
         * save time if you need to revert to a previous version.
         * It creates a folder called `aixupdatercache` under current directory
         * if not specified.
         */
        storageFolder?: string,
        /**
         * The max download concurrency. Default value 5.
         */
        maxConcurrency?: number,
    }

    export interface PatchInfo {
        /**
         * The path to the unpatched file
         */
        file: string,
        /**
         * The path to the patch file
         */
        patchFile: string,
        /**
         * The hash of the unpatched file
         */
        oldDigest: string,
        /**
         * The hash of the patched file
         */
        newDigest: string,
    }

    export interface FileProgress {
        percent: number,
        transferred: number,
        total: number,
    }

    export enum UpdateStatus {
        FETCH_REMOTE_VERSION,
        READ_LOCAL_VERSION,
        FETCH_MANIFEST,
        DOWNLOAD_PATCH,
        PATCH_FILE
    }

    export interface DownloadProgress {
        downloadProgress?: FileProgress;
        filesDownloaded: number;
        totalFiles: number;
    }

    export class UpdateProgress {
        status: UpdateStatus;
        step: number;
        totalSteps: number;
        downloadProgress?: DownloadProgress;

        constructor(status: UpdateStatus, step: number, totalSteps: number, downloadProgress?: DownloadProgress);
        toString(lang?: string): string;
    }
    
    class AiXCancellationToken {
        cancelled: boolean;
        cancel(reason: any): void;
        onCancellationRequested(listener: (reason: any) => void): void;
    }
}


/**
 * A NodeJS client for Aix Smart Update Protocal.
 * 
 * Example:
 * ```ts
 * // this will request resources under "https://download.example.com/update/my-awesome-app"
 * const updater = new AixUpdaterClient({
 *   baseUrl: "https://download.example.com/",
 *   artifact: "my-awesome-app",
 *   storageFolder: "./.aixupdatercache"
 * });
 * const newVersion = updater.update("./myAwesomeApp");
 * if (newVersion) {
 *   console.log(`Version ${newVersion} is installed.`)
 * } else {
 *   console.log(`No newer version is available.`)
 * }
 * ```
 */
declare class AixUpdaterClient {
    static selectBestMirror(urlList: string[]): Promise<string>;
    /**
     * Patch a local folder with a simple patch
     */
    static simplePatch(localPath: string, patchUrl: string, fullDownloadUrl: string | string[], progressListener?: (progress: AixUpdaterClient.UpdateProgress) => void, beforeUpdate?: () => Promise<void>): Promise<string>;

    constructor(options: AixUpdaterClient.AixUpdaterOptions);

    /**
     * Reads the current version of `localPath` by reading .version file
     * 
     * @param localPath the path to the local directory containing the need-to-update artifact.
     * 
     * @returns current version of `localPath`
     */
    getCurrentLocalVersion(localPath: string): Promise<string>;

    /**
     * Check the newest version online
     * 
     * @returns newest version online
     */
    getNewestRemoteVersion(): Promise<string>;

    /**
     * Compares local version against the newest version online.
     * 
     * @param currentVersion the current version to compare
     * @returns If there is a newer version available, returns the new version. Otherwise returns null.
     */
    hasNewVersion(currentVersion: string): Promise<string | null>;

    /**
     * Download patch files to temporary folder.
     * 
     * @param localPath the path to the local directory containing the need-to-update artifact.
     * @param toVersion the target version to update to
     * 
     * @returns the information on patch files.
     */
    fetchPatch(localPath: string, toVersion: string, progressListener?: (progress: AixUpdaterClient.UpdateProgress) => void): Promise<AixUpdaterClient.PatchInfo[]>;

    /**
     * Apply patch files to a folder
     * 
     * @param patches the patche files.
     * @param verifyOld check file integrity before patching
     * @param verifyNew check file integrity after patching
     */
    applyPatch(patches: AixUpdaterClient.PatchInfo[], verifyOld: boolean, verifyNew: boolean): Promise<void>;

    /**
     * Fetch newest patch files and apply them
     * 
     * @param localPath the path to the local directory containing the need-to-update artifact.
     * @param targetVersion the target version to update to
     *
     * @returns If a newer version is installed, returns the new version. Otherwise returns null.
     */
    update(localPath: string, targetVersion?: string, progressListener?: (progress: AixUpdaterClient.UpdateProgress) => void): Promise<string | null>;

    /**
     * Cleans up the local storage path.
     */
    cleanUp(): Promise<void>;
}

export = AixUpdaterClient;
