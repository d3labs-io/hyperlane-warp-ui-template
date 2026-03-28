const fs = require('fs');
const path = require('path');

const versionPath = path.resolve(__dirname, 'version.json');

if (!fs.existsSync(versionPath)) {
  const initialPkg = { version: '12.1.1' };
  fs.writeFileSync(versionPath, JSON.stringify(initialPkg, null, 2));
  console.log('Created version.json with version 12.1.1');
}

const pkg = JSON.parse(fs.readFileSync(versionPath, 'utf8'));

const currentVersion = pkg.version;
let [major, minor, patch] = currentVersion.split('.');
major = parseInt(major);
minor = parseInt(minor);
patch = parseInt(patch);

let newVersion = '';

if (patch === 9) {
  let newPatch = 0;
  let newMinor = minor + 1;
  let newMajor = major;

  if (newMinor > 9) {
    newMinor = 0;
    newMajor = major + 1;
  }

  newVersion = `${newMajor}.${newMinor}.${newPatch}`;
} else {
  let newPatch = patch + 1;
  let newMinor = minor;
  let newMajor = major;

  newVersion = `${newMajor}.${newMinor}.${newPatch}`;
}

if (newVersion !== currentVersion) {
  pkg.version = newVersion;
  fs.writeFileSync('./version.json', JSON.stringify(pkg, null, 2));
  console.log(`Version updated to ${newVersion}`);
} else {
  console.log('No version update required');
}
