# Serverless Diff-Patcher Update Protocol

## CDN File System Structure

```
<base_url>/
           patch/                     Directory, containing all patches
                 <Digest1>_<Digest2>  Binary File, the patch to update <Digest1> to <Digest2>
           files/                     Directory, containing all full-sized files
                 <Digest>             Binary File, the file with hashcode <Digest>
           manifest/                  Directory, containing all manifests
                    <Version>         Text File, a manifest of <Version>, separated by line. Each line has "<relative_path>\t<digest>" format.
           latest                     Text File, contains version code
```

`base_url` looks like this: `https://<cdn_host>/update/<artifact_id>`.
For example, "https://files.aixcoder.com/update/localserver"

## Publisher-side workflow

1. Get artifact id
      > "localserver"
2. Fetch newest version code
      > "0.0.2"
3. Calculate digest for each file, and save it to storage
      > File "model/python.dat" with digest "AABBCCDDEEFF"
      > 
      > Copy "model/python.dat" to "/storage/files/model/python.dat.AABBCCDDEEFF"
4. Compare up to 3 previous versions, generate patch for each file in each previous version.
5. If two files are same, ignore them. Otherwise, generate and save and upload a patch.
      > Local storage: /storage/patches/FFEEDDCCBBAA_AABBCCDDEEFF
      > 
      > CDN: https://<base_url>/patch/FFEEDDCCBBAA_AABBCCDDEEFF
      > 
6. Upload the full-sized file:
      > CDN: https://<base_url>/files/AABBCCDDEEFF
7. Upload newest manifest:
      > https://<base_url>/manifest/0.0.2
8. Overwrite the newest version:
      > https://<base_url>/latest "0.0.2"

## Client-side workflow

1. Get artifact id
      > "localserver"
2. Fetch newest version code
      > https://<base_url>/latest "0.0.2"
3. Fetch manifest
      > https://<base_url>/manifest/0.0.2
4. For each file in manifest, compare digest with local file, and generate a list of needed patches.
      > Old digest: FFEEDDCCBBAA, new digest: AABBCCDDEEFF => Patch name: FFEEDDCCBBAA_AABBCCDDEEFF
5. Download all patches
      > https://<base_url>/patch/FFEEDDCCBBAA_AABBCCDDEEFF
6. If patch exist, apply it. Otherwise, download the full-sized file.
      > https://<base_url>/files/AABBCCDDEEFF
