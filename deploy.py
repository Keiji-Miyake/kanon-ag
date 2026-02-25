import os
import shutil
import zipfile

EXT_DIR = "/home/user/.antigravity-server/extensions"
VSIX_PATH = "/home/user/workspace/kanon-ag/worktree/feat/kanon-cli-prototype/src/extension/kanon-antigravity-extension-0.0.11.vsix"
TARGET_DIR_NAME = "keiji-miyake.kanon-antigravity-extension-0.0.11"
TARGET_PATH = os.path.join(EXT_DIR, TARGET_DIR_NAME)

print(f"Deploying {VSIX_PATH} to {TARGET_PATH}...")

# 1. Clean up existing extensions
for item in os.listdir(EXT_DIR):
    if item.startswith("keiji-miyake.kanon-antigravity-extension"):
        path = os.path.join(EXT_DIR, item)
        print(f"Removing old extension: {path}")
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)

# 2. Extract VSIX
temp_extract = os.path.join(EXT_DIR, "temp_extract")
if os.path.exists(temp_extract):
    shutil.rmtree(temp_extract)
os.makedirs(temp_extract)

print("Extracting VSIX...")
with zipfile.ZipFile(VSIX_PATH, 'r') as zip_ref:
    zip_ref.extractall(temp_extract)

# 3. Move "extension" folder to target
source = os.path.join(temp_extract, "extension")
if not os.path.exists(source):
    print("Error: 'extension' folder not found in VSIX!")
    exit(1)

if os.path.exists(TARGET_PATH):
    shutil.rmtree(TARGET_PATH)

shutil.move(source, TARGET_PATH)
print(f"Moved extension content to {TARGET_PATH}")

# 4. Cleanup
shutil.rmtree(temp_extract)
print("Deployment complete!")
