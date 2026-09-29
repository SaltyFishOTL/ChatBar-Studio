"""Package an already-built web release without local data or credentials."""
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]


def main():
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8-sig"))
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8-sig"))
    version = package["version"]
    if lock["version"] != version:
        raise ValueError("package.json and lockfile versions differ")
    if not (ROOT / "dist/index.html").is_file():
        raise ValueError("Run npm run build first")
    sections = []
    for name, metadata in sorted(lock["packages"].items()):
        if not name:
            continue
        folder = ROOT / name
        if not folder.is_dir():
            continue  # Optional packages for other operating systems.
        notices = [p for p in folder.iterdir() if p.is_file() and
                   p.name.lower().startswith(("license", "licence", "notice", "copying"))]
        section = f"{name} @ {metadata.get('version', '')}\nLicense: {metadata.get('license', 'see package source')}\n"
        for path in sorted(notices):
            section += f"\n--- {path.name} ---\n{path.read_text(encoding='utf-8', errors='replace')}\n"
        sections.append(section)
    output = ROOT / "release"
    output.mkdir(exist_ok=True)
    archive = output / f"ChatBar-Studio-v{version}-web.zip"
    with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=6) as zipped:
        for path in sorted((ROOT / "dist").rglob("*")):
            if path.is_file():
                zipped.write(path, path.relative_to(ROOT).as_posix())
        for name in ["server.mjs", "LICENSE", "README.md", "THIRD_PARTY_NOTICES.md"]:
            zipped.write(ROOT / name, name)
        zipped.writestr("DEPENDENCY_LICENSES.txt", "\n\n".join(sections))
        zipped.writestr("START.txt", (
            f"ChatBar Studio v{version}\n\n"
            "Install Node.js 22 or later. Extract this ZIP, open its folder in a terminal,\n"
            "run: node server.mjs\nThen open: http://localhost:8080/\n"
            "No npm install is needed. For public hosting use HTTPS at the site root.\n\n"
            "Corresponding source and GPLv3 license:\n"
            f"https://github.com/SaltyFishOTL/ChatBar-Studio/tree/v{version}\n"
            "Related Android project: https://github.com/SaltyFishOTL/ChatChatBar\n"
        ))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / "SHA256SUMS.txt").write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
    print(f"Packaged {archive.name}: {archive.stat().st_size} bytes; {len(sections)} dependency notices")
    print(f"SHA-256 {digest}")


if __name__ == "__main__":
    main()
