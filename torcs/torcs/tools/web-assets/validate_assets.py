#!/usr/bin/env python3
"""Validate generated TORCS browser asset manifests."""

import argparse
import json
import math
import struct
import sys
from pathlib import Path


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
WAV_RIFF_MAGIC = b"RIFF"
WAV_WAVE_MAGIC = b"WAVE"
GOLDEN_TRACK_XML = "data/tracks/e-track-1/e-track-1.xml"
GOLDEN_CAR_XML = "data/cars/models/kc-2000gt/kc-2000gt.xml"
DEFAULT_TRACK_XMLS = [
	GOLDEN_TRACK_XML,
	"data/tracks/g-track-1/g-track-1.xml",
]
DEFAULT_CAR_XMLS = [
	GOLDEN_CAR_XML,
	"data/cars/models/kc-a110/kc-a110.xml",
]
VALID_CAR_LIGHT_TYPES = {"head1", "head2", "rear", "brake", "brake2"}


def fail(message):
	print(message, file=sys.stderr)
	return 1


def parse_args():
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("manifest", type=Path)
	parser.add_argument(
		"--quick",
		action="store_true",
		help="validate a quick golden-pair-only manifest",
	)
	return parser.parse_args()


def check_glb(path):
	data = path.read_bytes()
	if len(data) < 28:
		raise ValueError(f"{path} is too short")
	magic, version, total_length = struct.unpack("<III", data[:12])
	if magic != 0x46546C67 or version != 2:
		raise ValueError(f"{path} is not GLB 2.0")
	if total_length != len(data):
		raise ValueError(f"{path} length mismatch")
	offset = 12
	chunks = []
	gltf = None
	while offset < len(data):
		if offset + 8 > len(data):
			raise ValueError(f"{path} has truncated chunk header")
		length, kind = struct.unpack("<I4s", data[offset:offset + 8])
		offset += 8
		chunks.append(kind)
		payload = data[offset:offset + length]
		if kind == b"JSON":
			gltf = json.loads(payload.decode("utf-8"))
		offset += length
	if chunks[:2] != [b"JSON", b"BIN\0"]:
		raise ValueError(f"{path} missing JSON/BIN chunks")
	if not gltf:
		raise ValueError(f"{path} missing JSON chunk")
	for image in gltf.get("images", []):
		uri = image.get("uri")
		if not uri:
			raise ValueError(f"{path} has an image without a URI")
		if Path(uri).is_absolute() or ".." in Path(uri).parts:
			raise ValueError(f"{path} has unsafe image URI {uri}")
		check_texture(path.parent / uri)


def check_texture(path):
	if path.suffix.lower() != ".png":
		raise ValueError(f"{path} is not a PNG texture")
	if path.read_bytes()[:8] != PNG_MAGIC:
		raise ValueError(f"{path} has invalid PNG signature")


def check_wav(path):
	data = path.read_bytes()
	if len(data) < 44:
		raise ValueError(f"{path} is too short for WAV")
	if data[:4] != WAV_RIFF_MAGIC or data[8:12] != WAV_WAVE_MAGIC:
		raise ValueError(f"{path} has invalid WAV signature")


def require(root, relative_path):
	path = root / relative_path
	if not path.exists():
		raise ValueError(f"missing asset reference {relative_path}")
	return path


def check_object_names(entry, label):
	object_names = entry.get("objectNames")
	if not object_names or not all(isinstance(name, str) and name for name in object_names):
		raise ValueError(f"{label} missing object names")


def check_number_triplet(entry, field, label):
	values = entry.get(field)
	if not isinstance(values, list) or len(values) != 3:
		raise ValueError(f"{label} missing {field}")
	if not all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in values):
		raise ValueError(f"{label} has non-numeric {field}")


def check_number(entry, field, label):
	value = entry.get(field)
	if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
		raise ValueError(f"{label} missing numeric {field}")


def check_material_metadata(lod):
	classes = lod.get("materialClasses")
	if classes is not None:
		if not isinstance(classes, list) or not all(isinstance(name, str) and name for name in classes):
			raise ValueError(f"{lod.get('model', 'car LOD')} has malformed material classes")
	materials = lod.get("materials")
	if materials is None:
		return
	if not isinstance(materials, list):
		raise ValueError(f"{lod.get('model', 'car LOD')} has malformed material records")
	for material in materials:
		if not isinstance(material, dict):
			raise ValueError(f"{lod.get('model', 'car LOD')} has malformed material record")
		material_class = material.get("class")
		object_names = material.get("objectNames")
		if not isinstance(material_class, str) or not material_class:
			raise ValueError(f"{lod.get('model', 'car LOD')} has material without a class")
		if classes is not None and material_class not in classes:
			raise ValueError(f"{lod.get('model', 'car LOD')} has material class outside materialClasses")
		if not isinstance(object_names, list) or not all(isinstance(name, str) and name for name in object_names):
			raise ValueError(f"{lod.get('model', 'car LOD')} has material without object names")


def check_track_shadow_overlays(root, track):
	overlays = track.get("trackShadowOverlays", [])
	if not isinstance(overlays, list):
		raise ValueError(f"{track.get('source', 'track')} has malformed track shadow overlays")
	for overlay in overlays:
		if not isinstance(overlay, dict):
			raise ValueError(f"{track.get('source', 'track')} has malformed track shadow overlay")
		if overlay.get("role") != "trackShadow":
			raise ValueError(f"{track.get('source', 'track')} has unsupported track shadow overlay role")
		if overlay.get("layer") != "tiled":
			raise ValueError(f"{track.get('source', 'track')} has unsupported track shadow overlay layer")
		if not isinstance(overlay.get("sourceTexture"), str) or not overlay["sourceTexture"]:
			raise ValueError(f"{track.get('source', 'track')} has track shadow overlay without source texture")
		if not isinstance(overlay.get("texture"), str) or not overlay["texture"]:
			raise ValueError(f"{track.get('source', 'track')} has track shadow overlay without texture")
		check_texture(require(root, overlay["texture"]))


def check_car_lights(car):
	lights = car.get("lights")
	label = car.get("name", "car")
	if not isinstance(lights, list):
		raise ValueError(f"{label} has malformed light metadata")
	for index, light in enumerate(lights):
		light_label = f"{label} light {index}"
		if not isinstance(light, dict):
			raise ValueError(f"{light_label} has malformed light metadata")
		if light.get("type") not in VALID_CAR_LIGHT_TYPES:
			raise ValueError(f"{light_label} has unsupported type {light.get('type')}")
		check_number_triplet(light, "position", light_label)
		check_number(light, "size", light_label)
		if light["size"] <= 0:
			raise ValueError(f"{light_label} has non-positive size")


def main():
	args = parse_args()
	manifest_path = args.manifest.resolve()
	root = manifest_path.parent
	try:
		manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
		if manifest.get("version") != 1:
			raise ValueError("unsupported manifest version")
		tracks = manifest.get("tracks") or {}
		cars = manifest.get("cars") or {}
		required_tracks = [GOLDEN_TRACK_XML] if args.quick else DEFAULT_TRACK_XMLS
		required_cars = [GOLDEN_CAR_XML] if args.quick else DEFAULT_CAR_XMLS
		for track_xml in required_tracks:
			if track_xml not in tracks:
				raise ValueError(f"manifest missing required track {track_xml}")
		for car_xml in required_cars:
			if car_xml not in cars:
				raise ValueError(f"manifest missing required car {car_xml}")

		for track in tracks.values():
			check_glb(require(root, track["asset"]))
			check_object_names(track, track.get("source", "track"))
			label = track.get("source", "track")
			if not isinstance(track.get("backgroundType"), int):
				raise ValueError(f"{label} missing background type")
			for field in ["backgroundColor", "ambientColor", "diffuseColor", "specularColor", "lightPosition"]:
				check_number_triplet(track, field, label)
			check_number(track, "shininess", label)
			if track.get("backgroundTexture"):
				check_texture(require(root, track["backgroundTexture"]))
			check_material_metadata(track)
			check_track_shadow_overlays(root, track)
			for texture in track.get("textures", {}).values():
				check_texture(require(root, texture))
		for car in cars.values():
			check_car_lights(car)
			wheel_fallback = car.get("wheelFallback") or {}
			wheel_texture = wheel_fallback.get("texture")
			if wheel_fallback.get("source") != "runtime-snapshot" or not wheel_texture:
				raise ValueError("car missing runtime wheel fallback metadata")
			if wheel_texture not in car.get("textures", {}):
				raise ValueError(f"wheel fallback texture {wheel_texture} is not converted")
			sound = car.get("sound") or {}
			if not sound.get("engineSample") or not sound.get("engineAsset"):
				raise ValueError("car missing engine sound metadata")
			check_wav(require(root, sound["engineAsset"]))
			for field in ["rpmScale", "turboRpm", "turboLag"]:
				check_number(sound, field, f"{car.get('name', 'car')} sound")
			if not isinstance(sound.get("turbo"), bool):
				raise ValueError("car missing turbo sound metadata")
			if car.get("materialMask"):
				check_texture(require(root, car["materialMask"]))
			wheel_asset = car.get("wheelAsset")
			if wheel_asset:
				if wheel_asset.get("source") != "torcs-detailed-wheel-acc":
					raise ValueError("car detailed wheel asset has unsupported source")
				if not wheel_asset.get("directory") or not wheel_asset.get("basename"):
					raise ValueError("car detailed wheel asset missing directory or basename")
				thresholds = wheel_asset.get("speedThresholds")
				if thresholds != [20.0, 40.0, 70.0]:
					raise ValueError("car detailed wheel asset missing native speed thresholds")
				states = wheel_asset.get("states") or []
				if len(states) != 4:
					raise ValueError("car detailed wheel asset must contain four speed states")
				for index, state in enumerate(states):
					if state.get("speedIndex") != index:
						raise ValueError("car detailed wheel asset states must be ordered by speed index")
					check_glb(require(root, state["asset"]))
					check_object_names(state, state.get("source", "wheel"))
					check_material_metadata(state)
			for lod in car.get("lods", []):
				if "wheels" not in lod:
					raise ValueError(f"{lod.get('model', 'car LOD')} missing wheel visibility metadata")
				check_glb(require(root, lod["asset"]))
				check_object_names(lod, lod.get("model", "car LOD"))
				check_material_metadata(lod)
			for texture in car.get("textures", {}).values():
				check_texture(require(root, texture))
		effects = manifest.get("effects", {})
		effect_textures = effects.get("textures", {})
		for name in ["smoke.rgb", "fire0.rgb", "fire1.rgb", "frontlight1.rgb", "rearlight1.rgb", "breaklight1.rgb", "grey-tracks.rgb"]:
			if name not in effect_textures:
				raise ValueError(f"missing effect texture {name}")
			check_texture(require(root, effect_textures[name]))
		effect_sounds = effects.get("sounds", {})
		for name in ["skidTyres", "roadRide", "grassRide", "curbRide", "grassSkid", "metalSkid", "axle", "turbo", "backfireLoop", "backfire", "bang", "bottomCrash", "gearChange"]:
			entry = effect_sounds.get(name)
			if not entry or not entry.get("sample") or not entry.get("asset"):
				raise ValueError(f"missing effect sound {name}")
			check_wav(require(root, entry["asset"]))
		crashes = effects.get("crashes", [])
		if len(crashes) != 6:
			raise ValueError("missing crash sound set")
		for index, entry in enumerate(crashes, start=1):
			if entry.get("sample") != f"crash{index}.wav" or not entry.get("asset"):
				raise ValueError(f"malformed crash sound {index}")
			check_wav(require(root, entry["asset"]))
	except Exception as exc:
		return fail(f"TORCS web asset validation failed: {exc}")

	print(json.dumps({
		"manifest": str(manifest_path),
		"tracks": len(tracks),
		"cars": len(cars),
	}))
	return 0


if __name__ == "__main__":
	sys.exit(main())
