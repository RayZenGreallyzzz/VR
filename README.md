# Phoenix VR Avatar Studio (Android / Web)

Separate avatar-customization app derived from the workflow of Rig Animation Studio **v7.9**. Does not modify the original animation editor.

## v0.2 — 3D transforms (Android touch)

1. Import the main avatar GLB, then import any accessory GLB.
2. Select the accessory in the list and use **Двигать** to drag the 3D arrows in X/Y/Z.
3. Choose **Кольца XYZ** for axis rotation, or **Шар** for free-form rotation by dragging the central sphere.
4. Switch **Оси: локальные / мировые** to change gizmo axes. Numeric coordinates remain local to the attached bone.
5. For precise adjustments enter any finite XYZ value in metres and XYZ rotation in degrees, or tap the -/+ buttons.
6. Use **Сброс X/Y/Z**, **Сброс поворота**, or **Сброс всего** to undo placement.
7. Export GLB. The transform helper is an editor overlay, not part of the exported geometry.

**Limitations:** rotation pivot is the accessory origin on the attachment bone. The free-rotation sphere and axis rings need manual touch testing on Android 15. This is a rigid accessory transform tool; skin transfer / clothing rigging is separate. The original Rig Animation Studio is unchanged.

## First prototype
- Import GLB avatar, attach GLB hair, ears, horns, tail, wings, hats and accessories.
- Bone anchor presets: head / neck / chest / back / hips. Position, rotation and scale controls.
- Facial Blend Shape sliders (only if the imported GLB includes those morph targets).
- Basic skeleton, skinned mesh and triangle diagnostics (no hard polygon limit).
- Export an assembled GLB and a JSON configuration.

**Limitations:** rigid accessories are not skin-weighted clothing, new replacement heads do not have automatic seam blending, VRM/FBX import isn't present in v0.1, and VRChat publishing still requires Windows Unity Editor with VRChat SDK, Avatar Descriptor, humanoid mapping and platform-specific validation. This is not a finished production APK.

## Run
Requires Node.js and npm:
```sh
npm install
npm test
npm run dev
npm run build
npx cap add android
npm run android:apk
```
The GitHub Actions workflow can compile a **debug** Android APK after the source and dependencies are present in this repository.

## v7.9 source recovery
The supplied v7.9 APK contains 178 identifiable first-party TypeScript source files in the Vite source maps and bundled web assets. This is a **partial recovery**, not the complete original project source. The separate downloadable archive includes the recovered sources, bundled legacy editor and app prototype. APK native Gradle sources and signing keys were not recovered.

## Licenses
The legacy editor is based in part on Mesh2Motion (MIT code, upstream CC0 assets per its README). Three.js is MIT. Preserve source copyright/license notices and check rights before publishing third-party models or animations. Phoenix VR is not affiliated with VRChat or Unity.
