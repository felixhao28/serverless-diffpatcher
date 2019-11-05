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
    before(async() => {
        const port = await portfinder.getPortPromise();
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
        updater = new AixUpdaterClient({
            baseUrl: `http://localhost:${port}/`,
            artifact: "test-artifact"
        });
    });

    it("should update to v2", async() => {
        const v2path = "./test/v2";
        await fs.copy("./test/v1", localpath, { recursive: true });
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

    it("should update progress", async() => {
        await fs.copy("./test/v1", localpath, { recursive: true });
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
    });

    after(async() => {
        await updater.cleanUp();
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
        const v2path = "./test/v2";
        await fs.copy("./test/v1", localpath, { recursive: true });
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