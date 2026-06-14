# TORCS Asset Inspection Guide For Remastering

This guide explains how to inspect TORCS source assets before remastering them.
The goal is to find out what the original files already tell us about material
classes, object boundaries, texture atlases, lights, audio, track surfaces, and
authoring sources.

Use this when deciding whether a car or track can be improved with automatic
material overrides, whether it needs a hand-authored material mask, or whether a
flagship asset should be reworked in Blender or another DCC tool.

## What To Look For

For remastering, the most useful asset information usually falls into these
groups:

- **Object separation:** Are glass, lights, mirrors, exhausts, wings, wheels,
  cockpit, signs, barriers, trees, and road surfaces separate AC3D objects?
- **Texture assignment:** Does each object have a meaningful texture, or is
  nearly everything packed into one diffuse atlas?
- **Surface/material metadata:** Do XML surface names or AC3D material names
  reveal asphalt, grass, curb, barrier, glass, paint, metal, rubber, or lights?
- **UV layout:** Are different material regions separable by UV islands or only
  by pixels inside a shared atlas?
- **Authoring sources:** Are there `.xcf`, `.psd`, `.blend`, `.ac` source
  files, generated maps, object maps, or other files that preserve layer or
  generation information?
- **Runtime metadata:** Do XML sections provide light positions, exhaust
  positions, sound samples, LOD thresholds, wheel textures, track surfaces, fog,
  sky, or environment maps?

The inspection output should drive a concrete remaster decision:

| Finding | Recommended remaster path |
| --- | --- |
| Semantic object names and separate meshes exist | Use object-name material overrides. |
| One texture atlas contains multiple material types on the same object | Add a material mask in the same UV layout. |
| The source image has useful named layers | Derive masks from the layered source. |
| Objects and UVs are not clean enough | Re-author the asset or split meshes in a DCC tool. |
| Track XML surfaces are rich and consistent | Use XML surface names for automatic track material classes. |
| Track render mesh texture names are rich but XML is ambiguous | Infer classes from texture names and object names, then override manually where needed. |

## Key Asset Locations

The TORCS source tree keeps source assets under `data/`, while the web converter
is under `tools/web-assets/`.

```text
data/cars/models/<car-id>/
  <car-id>.xml          # car metadata, LODs, wheels, lights, exhaust, sound
  <car-id>.acc          # optimized AC3D render mesh used at runtime
  <car-id>-src.ac       # possible source AC3D mesh, when present
  <car-id>.rgb          # diffuse/livery atlas
  <car-id>.xcf          # possible layered GIMP source, when present
  driver.rgb            # driver texture, when present
  tex-wheel.rgb         # wheel texture, when present
  shadow.rgb            # planar shadow texture, when present

data/tracks/<track-id>/
data/tracks/<category>/<track-id>/
  <track-id>.xml        # track metadata, visual model, surfaces, lights, pits
  <track-id>.ac         # generated or source AC3D model
  <track-id>.acc        # optimized AC3D model used at runtime
  background.png        # sky/background image
  env.rgb/env.png       # environment map, when present
  object-map.png        # trackgen object-placement map, when present
  elevation-map.png     # trackgen terrain elevation map, when present
  raceline.png          # generated raceline/skid texture, when present
  *.rgb/*.png           # track surface, prop, tree, wall, sign textures

data/data/textures/     # shared textures
data/data/objects/      # shared objects and object textures
data/data/sound/        # shared sounds

tools/web-assets/
  convert_torcs_assets.py
  validate_assets.py
  convert_torcs_assets_test.py
```

The current web converter reads XML, AC3D, SGI `.rgb`, and audio files, then
emits GLB, PNG, copied WAVs, and `manifest.json`. It currently groups GLB
primitives mostly by texture, so it can collapse useful AC3D object boundaries
unless the converter is extended to preserve or re-split them.

## Start With The XML

XML files are the best first pass because they reveal which render assets are
actually used by TORCS.

### Car XML

For a car, inspect:

```bash
sed -n '1,220p' torcs/torcs/data/cars/models/car7-trb1/car7-trb1.xml
```

Important sections:

- `Graphic Objects`
  - `env`: optional environment asset.
  - `wheel texture`: simple wheel texture used by renderer fallback paths.
  - `shadow texture`: fake planar shadow texture.
  - `3d wheel basename` and `3d wheel directory`: wheel mesh variants.
  - `Ranges`: LOD thresholds, body model filenames, and wheel visibility.
- `Graphic Objects/Light`
  - Light type, position, and size. Useful for headlamp, brake lamp, rear lamp,
    bloom, emissive sprites, and future real light placement.
- `Exhaust`
  - Flame/smoke/audio emitter positions.
- `Sound` and `Engine`
  - Engine sample, RPM scale, turbo flag, turbo RPM, and turbo lag.
- `Bonnet` and `Driver`
  - Camera/driver presentation positions.

For `car7-trb1`, the XML points to one LOD, `car7-trb1.acc`, plus
`tex-wheel.rgb`, `shadow.rgb`, `f360.wav`, headlight/rear/brake light positions,
and two exhaust positions.

### Track XML

For a track, inspect:

```bash
sed -n '1,220p' torcs/torcs/data/tracks/e-track-1/e-track-1.xml
```

Important sections:

- `Header`
  - Display name, category, author, and version.
- `Graphic`
  - `3d description`: render model filename.
  - `background image`, `background type`, background color.
  - ambient, diffuse, specular, shininess, and light position values.
  - environment map metadata, when present.
- `Graphic/Terrain Generation`
  - terrain surface, object maps, border generation, and orientation.
- `Main Track`
  - default width and surface.
  - side, border, barrier, and pit definitions.
- `Main Track/Track Segments`
  - per-segment type, length/radius/arc, grade, banking, profile, and surface
    overrides.

For remastering, track XML surface names are often stronger material hints than
AC3D material IDs. Names like `asphalt-bw3`, `grass-bw1`, `curb-bw-l`,
`barrier-bw`, `sand`, `concrete`, and `tire-wall` can map directly to modern
material classes.

## Inventory The Asset Folder

List all files near the target asset:

```bash
find torcs/torcs/data/cars/models/car7-trb1 -maxdepth 2 -type f -print
find torcs/torcs/data/tracks/e-track-1 -maxdepth 2 -type f -print
```

Then identify file types:

```bash
file torcs/torcs/data/cars/models/car7-trb1/*
file torcs/torcs/data/tracks/e-track-1/*
```

Files worth prioritizing:

- `.acc`: optimized AC3D runtime mesh.
- `.ac` or `*-src.ac`: less-optimized source mesh; often better for editing.
- `.xcf`: layered GIMP source. This may preserve text, UV guides, paint layers,
  decals, or masks that were flattened into `.rgb`.
- `.rgb`: SGI image. The current converter can decode this to PNG.
- `object-map.png`, `elevation-map.png`, `relief*.png`: trackgen inputs that
  explain generated terrain or object placement.
- `readme.txt`: license and asset provenance.

If a layered `.xcf` exists, inspect it before painting masks from the flattened
texture. A layered source can save a lot of manual work.

Useful external tools, if installed:

```bash
xcfinfo torcs/torcs/data/cars/models/car7-trb1/car7-trb1.xcf
xcf2png torcs/torcs/data/cars/models/car7-trb1/car7-trb1.xcf > /tmp/car7-trb1.png
```

If those tools are not installed, `file` and `strings` can still reveal basic
metadata and possible layer/path names:

```bash
strings torcs/torcs/data/cars/models/car7-trb1/car7-trb1.xcf | sed -n '1,160p'
```

## Inspect AC3D Structure

The `.ac` and `.acc` files are text files. AC3D object names and texture names
are the most useful signals for remastering.

Start with a compact scan:

```bash
rg -n "^(MATERIAL|OBJECT|name |texture |numvert|numsurf|SURF|mat |refs|kids)" \
  torcs/torcs/data/cars/models/car7-trb1/car7-trb1.acc
```

What to look for:

- `MATERIAL` entries. Many TORCS assets have only one generic material, so do
  not assume material IDs are semantic.
- `OBJECT group` versus `OBJECT poly`. Groups preserve hierarchy; poly objects
  hold vertices and surfaces.
- `name "..."`. Object names often reveal semantic parts.
- `texture "..." base`. The first non-empty texture is the main diffuse texture.
- `texture "..." tiled`, `skids`, `shad`. These can reveal shadow/skid overlay
  channels on tracks.
- `SURF 0x14`, `SURF 0x34`, etc. The lower nibble is the primitive type. The
  current converter handles triangle fans, triangle strips, and triangle lists.
- `mat 0`. If all surfaces use one material index, material ID is not useful.

### Object Separation Audit

Use the converter's parser to summarize object names, textures, bounding boxes,
and UV ranges:

```bash
python3 - <<'PY'
import importlib.util
from pathlib import Path
from collections import Counter

module_path = Path("torcs/torcs/tools/web-assets/convert_torcs_assets.py")
spec = importlib.util.spec_from_file_location("convert", module_path)
convert = importlib.util.module_from_spec(spec)
spec.loader.exec_module(convert)

asset = Path("torcs/torcs/data/cars/models/car7-trb1/car7-trb1.acc")
objects = convert.parse_ac3d(asset)

print("objects", len(objects))
print("textures", Counter(obj.texture or "<none>" for obj in objects))

for obj in objects:
    refs = sum(len(surface["refs"]) for surface in obj.surfaces)
    xs = [vertex[0][0] for vertex in obj.vertices]
    ys = [vertex[0][1] for vertex in obj.vertices]
    zs = [vertex[0][2] for vertex in obj.vertices]
    us = []
    vs = []
    for surface in obj.surfaces:
        for _, u, v in surface["refs"]:
            us.append(u)
            vs.append(v)
    print(
        f"{obj.name:18s} tex={obj.texture or '<none>':16s} "
        f"verts={len(obj.vertices):4d} surfaces={len(obj.surfaces):3d} "
        f"refs={refs:5d} "
        f"bbox=({min(xs):6.2f},{min(ys):6.2f},{min(zs):6.2f}).."
        f"({max(xs):6.2f},{max(ys):6.2f},{max(zs):6.2f}) "
        f"uv=({min(us):.3f},{min(vs):.3f})..({max(us):.3f},{max(vs):.3f})"
    )
PY
```

For `car7-trb1`, this reveals 45 named objects. The object names are useful:

- `MIRRORBODY_s_3`, `MIRRORGLASS_s_1`
- `WIFRONTWIND_s_0`, `WIWINDOWREA_s_0`, `WIWINDOWSID_s_1`
- `WIFRONTLIGH_s_1`, `FRONTLIGHTD_s_1`, `FRONTLIGHTR_s_1`,
  `FRONTLIGHTB_s_1`
- `REARLIGHTFR_s_1`, `REARLIGHTIN_s_1`, `WIREARLIGHT_s_1`
- `EXHAUSTPIPE_s_3`
- `COCKPIT*`, `CONSOLE*`, `STEERINGWHE_s_0`, `SEATLEFT_s_2`
- `ROLLBAR_s_8`, `ANTENNA_s_0`, `WIPER_s_5`

That is strong evidence for object-name material overrides. However, most of
those objects still use `car7-trb1.rgb`, so texture assignment alone is not
enough.

### Semantic Group Audit

Group object names by likely material role:

```bash
python3 - <<'PY'
import importlib.util
from pathlib import Path

module_path = Path("torcs/torcs/tools/web-assets/convert_torcs_assets.py")
spec = importlib.util.spec_from_file_location("convert", module_path)
convert = importlib.util.module_from_spec(spec)
spec.loader.exec_module(convert)

asset = Path("torcs/torcs/data/cars/models/car7-trb1/car7-trb1.acc")
objects = convert.parse_ac3d(asset)

patterns = [
    ("glass/window", ["GLASS", "WINDOW", "WIND"]),
    ("front lights", ["FRONTLIGHT", "WIFRONTLIGH"]),
    ("rear lights", ["REARLIGHT", "WIREARLIGHT"]),
    ("mirror", ["MIRROR"]),
    ("exhaust", ["EXHAUST"]),
    ("body/paint candidates", [
        "ROOF", "CARBODY", "REARWING", "DIFFUSOR", "AIRIN", "AIROUT",
        "WHEELFRAME", "WHEELINSIDE",
    ]),
    ("interior/driver", [
        "COCKPIT", "CONSOLE", "STEERING", "SEAT", "DRIVER", "GIRTHS",
        "ROLLBAR",
    ]),
    ("small black/trim", ["WIPER", "ANTENNA"]),
]

used = set()
for label, keys in patterns:
    matches = [
        obj for obj in objects
        if any(key in obj.name.upper() for key in keys)
    ]
    used.update(obj.name for obj in matches)
    verts = sum(len(obj.vertices) for obj in matches)
    refs = sum(sum(len(surface["refs"]) for surface in obj.surfaces) for obj in matches)
    print(f"{label}: {len(matches)} objects, {verts} verts, {refs} refs")
    print("  " + ", ".join(obj.name for obj in matches))

other = [obj.name for obj in objects if obj.name not in used]
print("other:", len(other), ", ".join(other))
PY
```

This kind of audit answers the first remaster question: can the pipeline assign
different materials by object name without manual mesh edits?

## Inspect Texture Atlases

Most TORCS car textures are diffuse/livery atlases. They often combine paint,
glass, lights, decals, numbers, vents, shadows, and small trim details into one
image.

Convert `.rgb` to PNG using the current pipeline or run a quick conversion:

```bash
python3 torcs/torcs/tools/web-assets/convert_torcs_assets.py \
  --source-root torcs/torcs \
  --output-dir /tmp/torcs-web-assets \
  --quick
```

For a single texture, reuse the converter functions:

```bash
python3 - <<'PY'
import importlib.util
from pathlib import Path

module_path = Path("torcs/torcs/tools/web-assets/convert_torcs_assets.py")
spec = importlib.util.spec_from_file_location("convert", module_path)
convert = importlib.util.module_from_spec(spec)
spec.loader.exec_module(convert)

source = Path("torcs/torcs/data/cars/models/car7-trb1/car7-trb1.rgb")
output = convert.convert_texture(source, Path("/tmp/torcs-textures"))
print(output)
PY
```

When inspecting an atlas, mark:

- obvious paint regions
- decals, numbers, logos, and sponsor text
- glass/window regions
- front lamps, rear lamps, brake lamps
- mirror glass and mirror housing
- metal/exhaust/rollbar/wiper regions
- interior cloth/plastic/seat regions
- alpha channel usage, if any

Then compare those regions to object UV ranges from the AC3D audit. If each
semantic object samples a tight, separate UV area, object-level materials may be
enough. If one body object samples paint, decals, vents, shadows, and logos from
one large atlas, use a material mask.

### Material Mask Decision

Use a manual material mask when:

- paint and decals are on the same mesh object
- body objects mix paint, air intakes, number panels, logos, and shadow details
- you need different roughness/clearcoat for paint but not for decals
- you need emissive lamps but lamp pixels are not cleanly separate objects
- you want wetness or dirt behavior that should affect only selected pixels

Use object-name overrides when:

- glass objects are separate from body objects
- lamps are separate objects
- exhaust pipes, mirrors, wipers, rollbars, seats, or driver parts are separate
- track road, grass, curb, barrier, tree, sign, and building objects have
  distinct texture names

For many TORCS cars, the best result is a hybrid:

```text
original diffuse atlas -> livery/base color
object-name overrides  -> glass, lights, exhaust, interior, trim
material mask          -> paint versus decals/details inside large body atlas
```

## Inspect Current Converter Output

The current converter is useful for smoke testing but it does not preserve all
remaster signals in GLB form yet.

Run a quick conversion:

```bash
python3 torcs/torcs/tools/web-assets/convert_torcs_assets.py \
  --source-root torcs/torcs \
  --output-dir /tmp/torcs-web-assets \
  --quick
python3 torcs/torcs/tools/web-assets/validate_assets.py \
  /tmp/torcs-web-assets/manifest.json \
  --quick
```

Inspect the manifest:

```bash
python3 -m json.tool /tmp/torcs-web-assets/manifest.json | sed -n '1,220p'
```

Important current behavior:

- Track XML keys and car XML keys are preserved in `manifest.json`.
- Tracks include source model, converted GLB path, background, lighting colors,
  texture references, primitive count, and object names.
- Cars include wheel texture, shadow texture, sound metadata, LODs, texture
  references, primitive counts, and object names.
- Effects include smoke, fire, light, skid, crash, and global sound assets.
- AC3D object names are collected into metadata, but GLB primitives are grouped
  by texture.

For `car7-trb1`, converting the `.acc` directly produces only two texture-based
primitive groups: one for `car7-trb1.rgb` and one for `driver.rgb`. That means a
renderer cannot assign separate GLB materials to glass/lights/exhaust unless the
converter is extended to preserve object-level primitive splits or emit remaster
metadata that reclassifies objects before merging.

## Track-Specific Inspection

Tracks have richer material clues than cars because track XML surfaces describe
physics and generated render surfaces.

### Surface Names

Search a track XML for surface declarations:

```bash
rg -n 'name="surface"|<section name="(Left|Right) (Side|Border|Barrier)"|<section name="Track Segments"' \
  torcs/torcs/data/tracks/e-track-1/e-track-1.xml
```

Then map surface names to remaster classes:

| Surface clue | Likely class |
| --- | --- |
| `asphalt`, `road`, `tarmac` | asphalt/road |
| `pit` | pit asphalt/concrete |
| `curb`, `kerb` | curb |
| `grass` | grass |
| `sand` | sand/gravel |
| `dirt`, `mud` | dirt |
| `concrete` | concrete |
| `barrier`, `armco`, `wall` | barrier/metal/concrete wall |
| `tire-wall` | rubber/tire wall |
| `tree`, `arbor` | alpha vegetation |
| `fence` | alpha fence/metal |
| `sign`, `pylon`, `facade`, `roof` | prop/building/signage |

Surface metadata is especially useful for wet-road work: wetness should apply
to road-like and curb-like materials, not grass, buildings, trees, or signs.

### Render Model Objects And Textures

Track render models often have generated object names. Texture names are usually
the stronger classification signal.

```bash
rg -n "^(OBJECT|name |texture )" \
  torcs/torcs/data/tracks/e-track-1/e-track-1.acc | sed -n '1,220p'
```

For `e-track-1`, examples include:

- `TERR2` using `tr-grass-bw2.rgb`
- `TKMN...` using `tr-asphalt-bw3_n.rgb`
- `TKLS...` and pit sections using pit asphalt textures
- `B*RT*`/`B*LT*` barrier objects using `tr-barrier-bw.rgb`
- generated shadow overlays using `shadow2.rgb`
- skid/raceline textures such as `raceline.png`

Track AC3D may also include multiple texture channels per object:

```text
texture "tr-asphalt-bw3_n.rgb" base
texture "shadow2.rgb" tiled
texture "raceline.png" skids
texture empty_texture_no_mapping shad
```

The current web converter only keeps the first non-empty texture for an object.
If remastering needs shadows, skids, raceline overlays, or detail layers, the
converter needs a richer representation of these channels.

## Car-Specific Inspection

Cars need special handling because old racing-game cars usually use livery
atlases rather than material-authored meshes.

Inspect in this order:

1. XML `Ranges`: enumerate LOD models and wheel visibility.
2. XML `Light`: capture head/rear/brake light positions and types.
3. XML `Exhaust`: capture exhaust emitter positions.
4. XML `Sound` and `Engine`: capture engine sample and turbo metadata.
5. Asset folder: find `.acc`, `*-src.ac`, `.xcf`, diffuse, driver, wheel, and
   shadow textures.
6. AC3D object names: classify glass, lamps, exhaust, body, cockpit, trim.
7. Texture atlas: inspect whether paint, decals, glass, and lights are separable
   by object UVs or require masks.

For `car7-trb1`, the mesh is well-separated enough for object-level overrides
for windows, mirror glass, front/rear lights, exhaust, cockpit, driver, rollbar,
wiper, and antenna. It is not enough to isolate paint from decals and sponsor
graphics inside the shared `car7-trb1.rgb` atlas.

## Classifying Materials

Start with deterministic, explainable rules. Use hand-authored overrides only
where rules are wrong.

### Object Name Rules

Useful car object-name patterns:

| Pattern | Class |
| --- | --- |
| `GLASS`, `WINDOW`, `WIND` | glass |
| `FRONTLIGHT`, `HEAD` | headlamp |
| `REARLIGHT`, `WIREARLIGHT`, `BRAKE` | rear/brake lamp |
| `MIRRORGLASS` | mirror glass |
| `MIRRORBODY` | painted/black mirror housing |
| `EXHAUST` | hot metal/exhaust |
| `WIPER`, `ANTENNA` | black trim/metal |
| `ROLLBAR` | painted or bare metal, per car |
| `SEAT`, `COCKPIT`, `CONSOLE`, `STEERING` | interior |
| `DRIVER`, `GIRTHS` | driver/seatbelts |
| `CARBODY`, `ROOF`, `WING`, `DIFFUSOR`, `AIRIN`, `AIROUT` | body/paint candidates |

Useful track object-name patterns:

| Pattern | Class |
| --- | --- |
| `TKMN` | main track/road candidate |
| `TKLS`, `TKRS` | left/right side candidate |
| `B*LT`, `B*RT` | left/right barrier candidate |
| `TERR` | terrain |
| `PITS`, `PIT` | pit lane or pit building candidate |

Treat these as hints, not truth. Verify against texture names and screenshots.

### Texture Name Rules

Texture names are often more reliable than AC3D material IDs:

| Texture clue | Class |
| --- | --- |
| `asphalt`, `road`, `tarmac` | asphalt |
| `curb`, `kerb`, `rmbl` | curb |
| `grass` | grass |
| `sand`, `gravel`, `dirt` | loose surface |
| `barrier`, `wall`, `armco`, `barr` | barrier/wall |
| `tree`, `arbor`, `_n` alpha vegetation | tree/alpha card |
| `fence` | alpha fence |
| `smoke`, `fire`, `light`, `breaklight` | effect/emissive sprite |
| `shadow` | fake shadow |
| `wheel`, `tire`, `tyre` | rubber/wheel |
| `driver` | driver |

The current converter already uses a small texture-name rule for alpha testing:
tree, `trans-`, and `arbor` textures receive masked alpha. Extend that approach
with explicit material classes instead of relying on texture names inside the
renderer.

## Suggested Remaster Metadata

A practical remaster pipeline should keep original assets unchanged and add
metadata next to converted assets. For example:

```json
{
  "cars": {
    "data/cars/models/car7-trb1/car7-trb1.xml": {
      "materialMask": "cars/car7-trb1/car7-trb1-material-mask.png",
      "objectClasses": {
        "WIFRONTWIND_s_0": "glass",
        "WIWINDOWREA_s_0": "glass",
        "WIWINDOWSID_s_1": "glass",
        "MIRRORGLASS_s_1": "mirrorGlass",
        "FRONTLIGHTB_s_1": "headlamp",
        "REARLIGHTFR_s_1": "taillamp",
        "EXHAUSTPIPE_s_3": "exhaust",
        "WIPER_s_5": "blackTrim"
      },
      "atlasClasses": {
        "car7-trb1.rgb": {
          "red": "paint",
          "green": "glass",
          "blue": "lights",
          "alpha": "trim"
        }
      }
    }
  }
}
```

The exact schema can change, but it should preserve three separate concepts:

- **Diffuse/livery texture:** the original visual color and decals.
- **Object class:** material class inferred from mesh object name or override.
- **Material mask:** per-pixel classification for atlased regions.

This avoids baking remaster decisions into the original source files and lets
the legacy renderer path remain unchanged.

## Converter Improvements That Help Inspection

The current web converter is intentionally simple. These changes would make it
more useful for remastering:

1. Preserve object-level primitive splits in GLB, or emit one GLB primitive per
   `(texture, objectClass)` instead of only per texture.
2. Include object metadata with bounding boxes, texture names, UV bounds, and
   source object names in `manifest.json`.
3. Preserve AC3D texture channels: `base`, `tiled`, `skids`, and `shad`.
4. Preserve AC3D hierarchy for tracks where group names encode generated
   segment or LOD information.
5. Emit inferred material classes and confidence scores.
6. Allow hand-authored override files to correct material classes.
7. Copy optional material masks and layered-source provenance into the asset
   bundle.
8. Add validation that every object class used by the renderer appears in the
   manifest and every referenced mask/texture exists.

Do not throw away the source object names. Even when the runtime GLB stays
merged for performance, object names are valuable authoring metadata.

## Inspection Checklist

Use this checklist before remastering a car:

- XML LOD models listed and present.
- Wheel texture, shadow texture, sound sample, lights, and exhaust positions
  captured.
- `.acc` and any source `.ac` compared.
- Object count and object names summarized.
- Texture usage counted.
- AC3D material count checked.
- Texture atlas converted to PNG and visually inspected.
- Layered source image checked, if present.
- Candidate object-name material overrides listed.
- Manual material mask need decided.
- License/provenance readme checked.

Use this checklist before remastering a track:

- Track XML `Graphic/3d description` and background image captured.
- Ambient/diffuse/specular/light-position metadata captured.
- Main track, sides, borders, barriers, pits, and segment surfaces summarized.
- `.ac` and `.acc` compared.
- Object names and texture names summarized.
- Shared texture dependencies resolved from local track folder,
  `data/data/textures`, and `data/data/objects`.
- Object map, elevation map, raceline, and generated maps inspected.
- Road/curb/grass/barrier/tree/sign/building material classes assigned.
- Wetness eligibility decided from surface classes.
- Physics/render alignment risk noted.

## Recommended Workflow

1. Pick one target asset, such as `car7-trb1` or `e-track-1`.
2. Run the XML and folder inventory commands.
3. Run the AC3D object/texture audit.
4. Convert key `.rgb` textures to PNG for visual inspection.
5. Classify easy object-name materials first.
6. Decide which atlases need manual masks.
7. Add remaster metadata outside the original source asset.
8. Extend the converter only after the metadata need is clear.
9. Validate converted output with `validate_assets.py`.
10. Compare screenshots in legacy and modern render profiles.

The important rule is to inspect before inferring. TORCS assets vary: some have
useful object names, some have useful texture names, some have source files that
preserve authoring intent, and some are effectively flattened legacy atlases.
The remaster pipeline should use all available clues, then fall back to manual
masks or re-authoring only where the source files no longer carry enough
semantic information.
