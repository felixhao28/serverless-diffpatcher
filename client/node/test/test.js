/* eslint-disable no-undef */
const fs = require("fs-extra");
const { expect } = require("chai");
const path = require("path");
const handler = require("serve-handler");
const http = require("http");
const portfinder = require("portfinder");

const AixUpdaterClient = require("../AixUpdaterClient");

const localpath = "./test/v1-back";

describe("Online update", function() {
    /** @type {AixUpdaterClient} */
    let updater;
    let server;
    let port;
    before(async() => {
        port = await portfinder.getPortPromise();
        await new Promise((resolve, reject) => {
            try {
                server = http.createServer((request, response) => {
                    // You pass two more arguments for config and middleware
                    // More details here: https://github.com/zeit/serve-handler#options
                    return handler(request, response, {
                        public: "./test"
                    });
                });

                server.listen(port, () => {
                    console.log(`Test web server running at http://localhost:${port}`);
                    resolve();
                });
            } catch (e) {
                reject(e);
            }
        });
        await fs.remove(localpath);
    });

    it("should update to v2", async() => {
        updater = new AixUpdaterClient({
            baseUrl: `http://localhost:${port}/`,
            artifact: "test-artifact"
        });
        await fs.copy("./test/artifacts/base/v1", localpath, { recursive: true });
        const v2path = "./test/artifacts/base/v2";
        const newVersion = await updater.update(localpath);
        expect(newVersion).to.equal("0.0.2");

        const filelist = await fs.readdir(localpath);
        const v2filelist = await fs.readdir(v2path);
        expect(filelist.length).to.equal(v2filelist.length);

        await new Promise(resolve => setTimeout(resolve, 100));
        for (const f of filelist) {
            const buf1 = await fs.readFile(path.join(localpath, f));
            const buf2 = await fs.readFile(path.join(v2path, f));
            expect(buf1.equals(buf2));
        }

        await fs.remove(localpath);
        await updater.cleanUp();
    });

    it("patch file missing", async() => {
        updater = new AixUpdaterClient({
            baseUrl: `http://localhost:${port}/`,
            artifact: "test-artifact-miss-patch"
        });
        await fs.copy("./test/artifacts/missing-patch/v1", localpath, { recursive: true });
        const v2path = "./test/artifacts/missing-patch/v2";
        const newVersion = await updater.update(localpath);
        expect(newVersion).to.equal("0.0.2");

        const filelist = await fs.readdir(localpath);
        const v2filelist = await fs.readdir(v2path);
        expect(filelist.length).to.equal(v2filelist.length);

        await new Promise(resolve => setTimeout(resolve, 100));
        for (const f of filelist) {
            const buf1 = await fs.readFile(path.join(localpath, f));
            const buf2 = await fs.readFile(path.join(v2path, f));
            expect(buf1.equals(buf2));
        }

        await fs.remove(localpath);
        await updater.cleanUp();
    });

    it("patch new file", async() => {
        updater = new AixUpdaterClient({
            baseUrl: `http://localhost:${port}/`,
            artifact: "test-artifact-new-file"
        });
        await fs.copy("./test/artifacts/new-file/v1", localpath, { recursive: true });
        const v2path = "./test/artifacts/new-file/v2";
        const newVersion = await updater.update(localpath);
        expect(newVersion).to.equal("0.0.2");

        const filelist = await fs.readdir(localpath);
        const v2filelist = await fs.readdir(v2path);
        expect(filelist.length + 1).to.equal(v2filelist.length);

        await new Promise(resolve => setTimeout(resolve, 100));
        for (const f of filelist) {
            const buf1 = await fs.readFile(path.join(localpath, f));
            const buf2 = await fs.readFile(path.join(v2path, f));
            expect(buf1.equals(buf2));
        }

        await fs.remove(localpath);
        await updater.cleanUp();
    });

    it("should update progress", async() => {
        updater = new AixUpdaterClient({
            baseUrl: `http://localhost:${port}/`,
            artifact: "test-artifact"
        });
        await fs.copy("./test/artifacts/base/v1", localpath, { recursive: true });
        let log = "";
        /** @type {(progress: AixUpdaterClient.UpdateProgress) => void} */
        const cb = (progress) => {
            const l = progress.toString("zh");
            // console.log(l);
            log += l + "\n";
        };
        await updater.update(localpath, cb);
        // console.log(log);
        for (let i = 1; i < 6; i++) {
            expect(log.indexOf(`(${i}/6)`) >= 0);
        }
        await fs.remove(localpath);
        await updater.cleanUp();
    });

    it("simple patch", async() => {
        await fs.copy("./test/artifacts/base/v1", localpath, { recursive: true });
        const v2path = "./test/artifacts/base/v2";
        const newVersion = await AixUpdaterClient.simplePatch(localpath, `http://localhost:${port}/simplePatch/patch_0.0.1_0.0.2.zip`, `http://localhost:${port}/simplePatch/0.0.2.zip`);
        expect(newVersion).to.equal("0.0.2");

        const filelist = await fs.readdir(localpath);
        const v2filelist = await fs.readdir(v2path);
        expect(filelist.length).to.equal(v2filelist.length);

        await new Promise(resolve => setTimeout(resolve, 100));
        for (const f of filelist) {
            const buf1 = await fs.readFile(path.join(localpath, f));
            const buf2 = await fs.readFile(path.join(v2path, f));
            expect(buf1.equals(buf2));
        }

        await fs.remove(localpath);
    });

    after(async() => {
        server.close();
    });
});


describe("Offline update", function() {
    /** @type {AixUpdaterClient} */
    let updater;
    before(async() => {
        updater = new AixUpdaterClient({
            baseUrl: "file://./test/",
            artifact: "test-artifact"
        });
    });

    it("should update to v2", async() => {
        const v2path = "./test/artifacts/base/v2";
        await fs.copy("./test/artifacts/base/v1", localpath, { recursive: true });
        const newVersion = await updater.update(localpath);
        expect(newVersion).to.equal("0.0.2");

        const filelist = await fs.readdir(localpath);
        const v2filelist = await fs.readdir(v2path);
        expect(filelist.length).to.equal(v2filelist.length);

        for (const f of filelist) {
            const buf1 = await fs.readFile(path.join(localpath, f));
            const buf2 = await fs.readFile(path.join(v2path, f));
            expect(buf1.equals(buf2));
        }

        await fs.remove(localpath);
    });

    after(async() => {
        await updater.cleanUp();
    });
});

describe("Speed test", function() {
    let server;
    let port;
    before(async() => {
        port = await portfinder.getPortPromise();
        await new Promise((resolve, reject) => {
            try {
                server = http.createServer((request, response) => {
                    // You pass two more arguments for config and middleware
                    // More details here: https://github.com/zeit/serve-handler#options
                    return handler(request, response, {
                        public: "./test"
                    });
                });

                server.listen(port, () => {
                    console.log(`Test web server running at http://localhost:${port}`);
                    resolve();
                });
            } catch (e) {
                reject(e);
            }
        });
        await fs.remove(localpath);
    });

    it("should have good speed on correct mirror", async() => {
        const bestUrl = await AixUpdaterClient.selectBestMirror([
            `http://localhost:${port}/registry-test-artifact.error.json`,
            `http://localhost:${port}/registry-test-artifact.error2.json`,
            `http://localhost:${port}/registry-test-artifact.json`
        ]);
        expect(bestUrl).to.equal(`http://localhost:${port}/registry-test-artifact.json`);
    });

    after(async() => {
        console.log("server closing");
        server.close();
    });
});
