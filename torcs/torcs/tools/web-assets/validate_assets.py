#!/usr/bin/env python3
"""Validate generated TORCS browser asset manifests."""

import json
import math
import struct
import sys
from pathlib import Path


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
WAV_RIFF_MAGIC = b"RIFF"
WAV_WAVE_MAGIC = b"WAVE"


def fail(message):
	print(message, file=sys.stderr)
	return 1


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


def main():
	if len(sys.argv) != 2:
		return fail("usage: validate_assets.py <manifest.json>")
	manifest_path = Path(sys.argv[1]).resolve()
	root = manifest_path.parent
	try:
		manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
		if manifest.get("version") != 1:
			raise ValueError("unsupported manifest version")
		tracks = manifest.get("tracks") or {}
		cars = manifest.get("cars") or {}
		if "data/tracks/e-track-1/e-track-1.xml" not in tracks:
			raise ValueError("manifest missing E-Track 1")
		if "data/cars/models/kc-2000gt/kc-2000gt.xml" not in cars:
			raise ValueError("manifest missing kc-2000gt")

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
			for texture in track.get("textures", {}).values():
				check_texture(require(root, texture))
		for car in cars.values():
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
			for lod in car.get("lods", []):
				if "wheels" not in lod:
					raise ValueError(f"{lod.get('model', 'car LOD')} missing wheel visibility metadata")
				check_glb(require(root, lod["asset"]))
				check_object_names(lod, lod.get("model", "car LOD"))
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
