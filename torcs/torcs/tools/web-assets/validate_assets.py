#!/usr/bin/env python3
"""Validate generated TORCS browser asset manifests."""

import json
import struct
import sys
from pathlib import Path


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


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


def require(root, relative_path):
	path = root / relative_path
	if not path.exists():
		raise ValueError(f"missing asset reference {relative_path}")
	return path


def check_object_names(entry, label):
	object_names = entry.get("objectNames")
	if not object_names or not all(isinstance(name, str) and name for name in object_names):
		raise ValueError(f"{label} missing object names")


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
			if not isinstance(track.get("backgroundType"), int):
				raise ValueError(f"{track.get('source', 'track')} missing background type")
			if not isinstance(track.get("backgroundColor"), list) or len(track["backgroundColor"]) != 3:
				raise ValueError(f"{track.get('source', 'track')} missing background color")
			if not isinstance(track.get("ambientColor"), list) or len(track["ambientColor"]) != 3:
				raise ValueError(f"{track.get('source', 'track')} missing ambient color")
			if not isinstance(track.get("diffuseColor"), list) or len(track["diffuseColor"]) != 3:
				raise ValueError(f"{track.get('source', 'track')} missing diffuse color")
			if not isinstance(track.get("lightPosition"), list) or len(track["lightPosition"]) != 3:
				raise ValueError(f"{track.get('source', 'track')} missing light position")
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
			for lod in car.get("lods", []):
				if "wheels" not in lod:
					raise ValueError(f"{lod.get('model', 'car LOD')} missing wheel visibility metadata")
				check_glb(require(root, lod["asset"]))
				check_object_names(lod, lod.get("model", "car LOD"))
			for texture in car.get("textures", {}).values():
				check_texture(require(root, texture))
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
