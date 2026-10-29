# Android build and verification (v0.1)

This branch is used to run the full Android Gradle build on GitHub-hosted runners.

## Checks before packaging
- `npm test`: 6 automated core tests.
- `node --check src/main.js` and `node --check src/avatar-core.mjs`: JavaScript syntax.
- HTML event target IDs are checked against the script.
- `npm run build`: Vite creates the production bundle.
- `npx cap add android` and `npm run android:apk`: generates and assembles a debug APK.

## Manual Android 15 test checklist
1. Install APK and launch from launcher.
2. Open the included mannequin demo (no rig) and verify rendering and touch orbit controls.
3. Import a rigged GLB; check head and hips detection.
4. Import hair and ears as GLB accessories; test anchoring and offsets.
5. Adjust available facial morph sliders.
6. Export a GLB and JSON; re-import into a 3D viewer.
7. Rotate the tablet and test landscape / portrait UI.

Known limitations: no auto-skinning clothes, no standalone FBX or VRM import, no VRChat SDK upload, no actual Android device launch verification yet. An Android debug APK is not a release-signed APK.

**Original Rig Animation Studio v7.9 is not modified.**
