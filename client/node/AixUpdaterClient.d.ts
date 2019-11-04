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
    constructor(options: AixUpdaterClient.AixUpdaterOptions);

    /**
     * Reads the current version of `localPath` by reading .version file
     * 
     * @param localPath the path to the local directory containing the need-to-update artifact.
     * 
     * @returns current version of `localPath`
     */
    async getCurrentLocalVersion(localPath: string): Promise<string>;

    /**
     * Check the newest version online
     * 
     * @returns newest version online
     */
    async getNewestRemoteVersion(): Promise<string>;

    /**
     * Compares local version against the newest version online.
     * 
     * @param currentVersion the current version to compare
     * @returns If there is a newer version available, returns the new version. Otherwise returns null.
     */
    async hasNewVersion(currentVersion: string): Promise<string | null>;

    /**
     * Download patch files to temporary folder.
     * 
     * @param localPath the path to the local directory containing the need-to-update artifact.
     * @param toVersion the target version to update to
     * 
     * @returns the information on patch files.
     */
    async fetchPatch(localPath: string, toVersion: string): Promise<AixUpdaterClient.PatchInfo[]>;

    /**
     * Apply patch files to a folder
     * 
     * @param patches the patche files.
     * @param verifyOld check file integrity before patching
     * @param verifyNew check file integrity after patching
     */
    async applyPatch(patches: AixUpdaterClient.PatchInfo[], verifyOld=true, verifyNew=true): Promise<void>;

    /**
     * Fetch newest patch files and 
     * 
     * @param localPath the path to the local directory containing the need-to-update artifact.
     * @param targetVersion the target version to update to
     *
     * @returns If a newer version is installed, returns the new version. Otherwise returns null.
     */
    async update(localPath: string, targetVersion?: string): Promise<string | null>;

    /**
     * Cleans up the local storage path.
     */
    async cleanUp(): Promise<void>;
}

export = AixUpdaterClient;
