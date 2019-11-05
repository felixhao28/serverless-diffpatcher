import re
import argparse
import oss2
import xxhash
import sys
import os
import json
import shutil
import errno
import bsdiff4
import fnmatch
from past.builtins import raw_input

if sys.version_info >= (3, 5):
    from typing import List, Tuple


def mkdir_p(path):
    try:
        os.makedirs(path)
    except OSError as exc:  # Python >2.5
        if exc.errno == errno.EEXIST and os.path.isdir(path):
            pass
        else:
            raise


def get_version(version, new_dir):
    if version is not None and not re.fullmatch(r'\d+(\.\d+)*', version):
        print("Version {} is not in <number>[.<number>[.<number>]] format")

    version_file = os.path.join(new_dir, ".version")
    if os.path.exists(version_file):
        with open(version_file, 'r', encoding='utf-8') as f:
            version_file_version = f.read().strip()
            if version is not None:
                if version_file_version != version:
                    print(os.path.realpath(new_dir) + "/.version and <version> does not match!")
                    sys.exit(-1)
            else:
                version = version_file_version
    else:
        if version is None:
            print("Neither " + os.path.realpath(new_dir) + "/.version or <version> argument is provided!")
            sys.exit(-1)
        print(".version file does not exist, generating...")
        with open(version_file, 'w', encoding='utf-8') as f:
            f.write(version)
    print("Version {} detected.".format(version))
    return version


def query_yes_no(question, default="yes"):
    """Ask a yes/no question via raw_input() and return their answer.

    "question" is a string that is presented to the user.
    "default" is the presumed answer if the user just hits <Enter>.
        It must be "yes" (the default), "no" or None (meaning
        an answer is required of the user).

    The "answer" return value is True for "yes" or False for "no".
    """
    valid = {"yes": True, "y": True, "ye": True,
             "no": False, "n": False}
    if default is None:
        prompt = " [y/n] "
    elif default == "yes":
        prompt = " [Y/n] "
    elif default == "no":
        prompt = " [y/N] "
    else:
        raise ValueError("invalid default answer: '%s'" % default)

    while True:
        sys.stdout.write(question + prompt)
        choice = raw_input().lower()
        if default is not None and choice == '':
            return valid[default]
        elif choice in valid:
            return valid[choice]
        else:
            sys.stdout.write("Please respond with 'yes' or 'no' "
                             "(or 'y' or 'n').\n")


class Storage:
    def __init__(self, storage_dir, storage_registry_file):
        self.storage_dir = os.path.realpath(storage_dir)
        self.storage_registry_file = storage_registry_file
        self.storage_registry = None

        if not os.path.exists(self.storage_dir):
            os.makedirs(self.storage_dir)
        storage_registry = {"versions": [], "files": {}}
        if os.path.exists(self.storage_registry_file):
            with open(self.storage_registry_file, "r", encoding="utf-8") as f:
                storage_registry = json.load(f)
        self.storage_registry = storage_registry

    def save(self):
        with open(self.storage_registry_file, "w", encoding='utf-8') as f:
            f.write(json.dumps(self.storage_registry, indent=2))

    def handle_dir(self, path, base_dir=None, ignore_patterns=None):
        if base_dir is None:
            base_dir = path
        if ignore_patterns is None:
            ignore_patterns = []
        else:
            ignore_patterns = list(ignore_patterns)
        try:
            with open(os.path.join(path, ".aixignore"), "r", encoding="utf-8") as f:
                ignore_patterns.extend((path, line.strip()) for line in f.readlines())
        except FileNotFoundError:
            pass

        files = []
        for f in os.listdir(path):
            full_path = os.path.join(path, f)  # type: str
            if os.path.isdir(full_path):
                files.extend(self.handle_dir(full_path, base_dir, ignore_patterns=ignore_patterns))
            else:
                r = self.handle_file(full_path, base_dir, ignore_patterns=ignore_patterns)
                if r:
                    files.append(r)
        return files

    def handle_file(self, path, base_dir, ignore_patterns):
        for relative_folder, ignore_pattern in ignore_patterns:
            relative_path = os.path.relpath(path, relative_folder)
            if fnmatch.fnmatch(relative_path, ignore_pattern):
                return

        storage_registry = self.storage_registry
        with open(path, "rb") as f:
            buffer = f.read()
        digest = xxhash.xxh64_hexdigest(buffer)  # type: str
        friendly_path = os.path.relpath(path, base_dir)
        if friendly_path not in storage_registry["files"]:
            storage_registry["files"][friendly_path] = {}
        original_dir = os.path.realpath(os.path.dirname(path))
        file_name = os.path.basename(path)
        rel_original_dir = os.path.relpath(original_dir, base_dir)
        mkdir_p(os.path.join(self.storage_dir, "files", rel_original_dir))
        target_rel_path = os.path.join("files", rel_original_dir, file_name + "." + digest)
        is_new = False
        if digest not in storage_registry["files"][friendly_path]:
            # save file to storage
            is_new = True
            target_full_path = os.path.join(self.storage_dir, target_rel_path)
            shutil.copy(path, target_full_path)
            storage_registry["files"][friendly_path][digest] = target_full_path
            storage_registry["files"][friendly_path]["latest"] = target_full_path
        if is_new:
            print("New file found: {}...{}".format(friendly_path, digest))
        else:
            print("Existing file found: {}...{}".format(friendly_path, digest))
        return is_new, friendly_path, digest, target_rel_path

    def generate_patch(self, file_from, file_to, save_name):
        mkdir_p(os.path.join(self.storage_dir, "patches"))
        from_path = os.path.join(self.storage_dir, file_from)
        to_path = os.path.join(self.storage_dir, file_to)
        patch_path = os.path.join(self.storage_dir, "patches", save_name)
        bsdiff4.file_diff(from_path, to_path, patch_path)
        assert os.path.exists(patch_path), "Patch file from {] to {} => {} not generated!".format(from_path, to_path, patch_path)
        print("Patch file from {} to {} => {} generated!".format(from_path, to_path, patch_path))
        return patch_path


def parse_args():
    parser = argparse.ArgumentParser("aix smart update server side")
    parser.add_argument("artifact_id", type=str)
    parser.add_argument("source_folder", type=str)
    parser.add_argument("version", nargs='?', default=None, type=str)
    parser.add_argument("--offline", action="store_true", default=False)
    parser.add_argument("--dry", action="store_true", default=False)
    args = parser.parse_args()

    artifact = args.artifact_id
    new_dir = args.source_folder

    version = get_version(args.version, new_dir)
    return artifact, new_dir, version, args.offline, args.dry


def read_aliyunoss_properties(filename):
    properties = {}
    with open(filename, "r", encoding="utf-8") as f:
        for line in f.readlines():
            line = line.strip()
            if line.startswith("#"):
                continue
            m = re.fullmatch(r'(.+?)\s*=\s*(.+?)', line)
            if m:
                key = m.group(1)
                value = m.group(2)
                properties[key] = value
    return properties["spring.file.endpoint"], properties["spring.file.keyid"], properties["spring.file.keysecret"], properties["spring.file.bucketname"]


def main():
    # 当前制品id > "localserver"
    # 拿到新版本号  > "0.0.3"
    artifact, new_dir, version, offline, dry = parse_args()
    # if not query_yes_no("Artifact={}, Version={}, location: {}\nContinue?".format(artifact, version, new_dir)):
    #     sys.exit(-1)
    if dry:
        def upload(target_path, source):
            if len(source) < 256 and os.path.exists(source):
                print("%dry run%: copy {} to {}".format(source, target_path))
            else:
                print("%dry run%: write content to {}\n===<START>===\n{}\n===<END>===\n".format(target_path, source))
    elif offline:
        def upload(target_path, source):
            mkdir_p(os.path.dirname(target_path))
            if len(source) < 256 and os.path.exists(source):
                shutil.copy(source, target_path)
            else:
                with open(target_path, "w", encoding="utf-8") as f:
                    f.write(source)
    else:
        endpoint, keyid, keysecret, bucketname = read_aliyunoss_properties("aliyunoss.properties")
        auth = oss2.Auth(keyid, keysecret)
        bucket = oss2.Bucket(auth, endpoint, bucketname)

        def upload(target_path, source):
            bucket.put_object_from_file(target_path, source)

    storage = Storage("storage-{}".format(artifact), "registry-{}.json".format(artifact))
    for old_version in storage.storage_registry["versions"]:
        if old_version["version"] == version:
            if not query_yes_no("Version {} already exist, override?".format(version)):
                sys.exit(-1)
            storage.storage_registry["versions"].remove(old_version)
    # 计算每一个文件的digest 11223344,以及路径 model/python.dat，将文件保存到storage > /storage/files/model/python.dat.11223344
    files = storage.handle_dir(new_dir)  # type: List[Tuple[bool, str, str, str]] # is_new, path, digest, target_full_path

    for prev_version_info in storage.storage_registry["versions"][-3:]:
        prev_version = prev_version_info["version"]
        prev_files = prev_version_info["files"]
        for is_new, new_path, new_digest, new_target_rel_path in files:
            if not is_new:
                continue
            for _, old_path, old_digest, old_target_rel_path in prev_files:
                if new_path == old_path and new_digest != old_digest:
                    # 如果文件不一样，产生patch文件，保存到 /storage/patches/FFEEDDCCBBAA_AABBCCDDEEFF
                    patch_filename = old_digest + "_" + new_digest
                    print("Calculate patch from {}@{} to {}@{} => {}".format(old_target_rel_path, prev_version, new_target_rel_path, version, patch_filename))
                    patch_path = storage.generate_patch(old_target_rel_path, new_target_rel_path, patch_filename)
                    # 上传 > https://files.aixcoder.com/update/localserver/patch/FFEEDDCCBBAA_AABBCCDDEEFF
                    upload("update/{}/patch/{}".format(artifact, patch_filename), patch_path)

    # 上传新的文件到 > http://aixcoderbucket.oss-cn-beijing.aliyuncs.com/update/localserver/files/AABBCCDDEEFF
    for is_new, new_path, new_digest, new_target_rel_path in files:
        if is_new:
            oss_target_path = "update/{}/files/{}".format(artifact, new_digest)
            print("Uploading new file {}...{} => {}".format(new_target_rel_path, new_digest, oss_target_path))
            upload(oss_target_path, os.path.join(storage.storage_dir, new_target_rel_path))

    # 更新最新版本号对应的filelist > http://aixcoderbucket.oss-cn-beijing.aliyuncs.com/update/localserver/filelist/0.0.3
    filelist_lines = []
    for is_new, new_path, new_digest, new_target_rel_path in files:
        filelist_lines.append(new_path + "\t" + new_digest)
    filelist_lines_content = "\n".join(filelist_lines)
    filelist_oss_target_path = "update/{}/filelist/{}".format(artifact, version)
    print("Uploading file list => {}\n=========\n{}\n===END===\n".format(filelist_oss_target_path, filelist_lines_content))
    upload(filelist_oss_target_path, filelist_lines_content)
    # 更新最新版本号 > http://aixcoderbucket.oss-cn-beijing.aliyuncs.com/update/localserver/latest "0.0.3"

    storage.storage_registry["versions"].append({
        "version": version,
        "files": files
    })
    upload("update/{}/latest".format(artifact), version)
    if not dry:
        storage.save()


if __name__ == '__main__':
    main()
