# Serverless Diff-Patcher Update Protocol

## Server-side

中文版：
客户端逻辑

当前制品id > "localserver"
拿到最新版本号  >  https://files.aixcoder.com/update/localserver/latest "0.0.2"
下载最新版本号对应的manifest > https://files.aixcoder.com/update/localserver/manifest/0.0.2
对比本地文件，获得需要更新的文件列表，包括每个文件的路径，本地digest，目标digest > model/python.dat AABBCCDDEEFF , 本地digest=FFEEDDCCBBAA
下载每一个文件的patch > https://files.aixcoder.com/update/localserver/patch/FFEEDDCCBBAA_AABBCCDDEEFF
## 如果patch存在，应用patch
## 如果patch不存在，直接下载最新版本替代 > https://files.aixcoder.com/update/localserver/files/AABBCCDDEEFF

服务端逻辑

制品有新版本时：
当前制品id > "localserver"
拿到新版本号  > "0.0.3"
计算每一个文件的digest 11223344,以及路径 model/python.dat，将文件保存到storage > /storage/files/model/python.dat.11223344
对最多前3个版本，计算每个文件的patch：
## 如果文件一样，无视
## 如果文件不一样，产生patch文件，保存到 /storage/patches/FFEEDDCCBBAA_AABBCCDDEEFF ，上传 > https://files.aixcoder.com/update/localserver/patch/FFEEDDCCBBAA_AABBCCDDEEFF
## 上传新的文件到 > http://aixcoderbucket.oss-cn-beijing.aliyuncs.com/update/localserver/files/AABBCCDDEEFF
更新最新版本号对应的manifest > http://aixcoderbucket.oss-cn-beijing.aliyuncs.com/update/localserver/manifest/0.0.3
更新最新版本号 > http://aixcoderbucket.oss-cn-beijing.aliyuncs.com/update/localserver/latest "0.0.3"

base_url = http://aixcoderbucket.oss-cn-beijing.aliyuncs.com/update/&lt;artifact_id&gt;

```
<base_url>/
           patch/                     目录，包含所有补丁
                 <Digest1>_<Digest2>  文件，表示从<Digest1>升级为<Digest2>需要的补丁
           files/                     目录，包含所有完整文件
                 <Digest>             文件，<Digest>对应的文件
           manifest/                  目录，包含每个版本的文件列表
                    <Version>         文件，版本号对应的文件列表。按行分隔，每行格式为
           latest                     文件，内容为版本号
```