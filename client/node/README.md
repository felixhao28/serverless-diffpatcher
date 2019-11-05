# A NodeJS client for Aix Smart Update Protocal.

Example:
```ts
// this will request resources under "https://download.example.com/update/my-awesome-app"
const updater = new AixUpdaterClient({
    baseUrl: "https://download.example.com/",
    artifact: "my-awesome-app",
    storageFolder: "./.aixupdatercache"
});
const newVersion = updater.update("./myAwesomeApp");
if (newVersion) {
    console.log(`Version ${newVersion} is installed.`);
} else {
    console.log(`No newer version is available.`);
}
```
