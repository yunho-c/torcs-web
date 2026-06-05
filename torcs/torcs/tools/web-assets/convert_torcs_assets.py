#!/usr/bin/env python3
"""Convert the first TORCS browser renderer asset set to web-native files."""

import argparse
import json
import re
import shutil
import struct
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree


TRACK_XML = Path("data/tracks/e-track-1/e-track-1.xml")
CAR_XML = Path("data/cars/models/kc-2000gt/kc-2000gt.xml")
EMPTY_TEXTURE = "empty_texture_no_mapping"
AC_SURFACE_FAN = 0
AC_SURFACE_LINE_LOOP = 1
AC_SURFACE_LINE_STRIP = 2
AC_SURFACE_TRIANGLES = 3
AC_SURFACE_TRIANGLE_STRIP = 4
TREE_ALPHA_CUTOFF = 0.65


@dataclass
class AcObject:
	name: str = ""
	texture: str = ""
	vertices: list = field(default_factory=list)
	surfaces: list = field(default_factory=list)


def parse_args():
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--source-root", type=Path, required=True)
	parser.add_argument("--output-dir", type=Path, required=True)
	return parser.parse_args()


def clear_generated_output(output_dir):
	for name in ("tracks", "cars", "manifest.json"):
		path = output_dir / name
		if path.is_dir():
			shutil.rmtree(path)
		elif path.exists():
			path.unlink()


def clean_xml(path):
	text = path.read_text(encoding="utf-8")
	start = text.find("<!DOCTYPE")
	if start >= 0:
		subset_end = text.find("]>", start)
		end = subset_end + 2 if subset_end >= 0 else text.find(">", start) + 1
		text = text[:start] + text[end:]
	text = re.sub(r"^\s*&[A-Za-z0-9_.-]+;\s*$", "", text, flags=re.MULTILINE)
	return text


def attstr(section, name, default=""):
	for child in section:
		if child.tag == "attstr" and child.attrib.get("name") == name:
			return child.attrib.get("val", default)
	return default


def attnum(section, name, default=0.0):
	for child in section:
		if child.tag == "attnum" and child.attrib.get("name") == name:
			return float(child.attrib.get("val", default))
	return default


def find_section(section, *names):
	current = section
	for name in names:
		for child in current:
			if child.tag == "section" and child.attrib.get("name") == name:
				current = child
				break
		else:
			return None
	return current


def parse_track_metadata(source_root):
	root = ElementTree.fromstring(clean_xml(source_root / TRACK_XML))
	header = find_section(root, "Header")
	graphic = find_section(root, "Graphic")
	return {
		"xml": str(TRACK_XML),
		"name": attstr(header, "name"),
		"category": attstr(header, "category"),
		"model": attstr(graphic, "3d description"),
		"background": attstr(graphic, "background image"),
		"backgroundType": int(attnum(graphic, "background type", 0)),
		"backgroundColor": [
			attnum(graphic, "background color R", 0.45),
			attnum(graphic, "background color G", 0.45),
			attnum(graphic, "background color B", 0.5),
		],
		"ambientColor": [
			attnum(graphic, "ambient color R", 0.1),
			attnum(graphic, "ambient color G", 0.1),
			attnum(graphic, "ambient color B", 0.05),
		],
		"diffuseColor": [
			attnum(graphic, "diffuse color R", 1.0),
			attnum(graphic, "diffuse color G", 1.0),
			attnum(graphic, "diffuse color B", 1.0),
		],
		"lightPosition": [
			attnum(graphic, "light position x", 0.0),
			attnum(graphic, "light position y", 10000.0),
			attnum(graphic, "light position z", 3000.0),
		],
	}


def parse_car_metadata(source_root):
	root = ElementTree.fromstring(clean_xml(source_root / CAR_XML))
	objects = find_section(root, "Graphic Objects")
	ranges = find_section(objects, "Ranges")
	lods = []
	for child in ranges:
		if child.tag != "section":
			continue
		lods.append({
			"threshold": attnum(child, "threshold"),
			"model": attstr(child, "car"),
			"wheels": attstr(child, "wheels") == "yes",
		})
	lods.sort(key=lambda lod: lod["threshold"], reverse=True)
	return {
		"xml": str(CAR_XML),
		"name": root.attrib.get("name", "kc-2000gt"),
		"wheelTexture": attstr(objects, "wheel texture"),
		"shadowTexture": attstr(objects, "shadow texture"),
		"lods": lods,
	}


def parse_ac3d(path):
	lines = path.read_text(encoding="latin-1").splitlines()
	if not lines or not lines[0].startswith("AC3D"):
		raise ValueError(f"{path} is not an AC3D file")

	objects = []
	stack = []
	index = 1
	while index < len(lines):
		line = lines[index].strip()
		index += 1
		if not line or line.startswith("MATERIAL"):
			continue
		parts = line.split(None, 1)
		key = parts[0]
		value = parts[1] if len(parts) > 1 else ""
		if key == "OBJECT":
			obj = AcObject()
			objects.append(obj)
			stack.append(obj)
			continue
		if not stack:
			continue
		obj = stack[-1]
		if key == "name":
			obj.name = value.strip('"')
		elif key == "texture" and not obj.texture:
			tex = value.split()[0].strip('"')
			if tex != EMPTY_TEXTURE:
				obj.texture = tex
		elif key == "numvert":
			count = int(value)
			for _ in range(count):
				values = [float(part) for part in lines[index].split()]
				index += 1
				position = values[0:3]
				normal = values[3:6] if len(values) >= 6 else [0.0, 1.0, 0.0]
				obj.vertices.append((position, normal))
		elif key == "numsurf":
			count = int(value)
			for _ in range(count):
				surface = {"flags": AC_SURFACE_FAN, "refs": []}
				while index < len(lines):
					surf_line = lines[index].strip()
					index += 1
					if surf_line.startswith("SURF "):
						surface["flags"] = int(surf_line.split()[1], 0)
					if surf_line.startswith("refs "):
						ref_count = int(surf_line.split()[1])
						for _ in range(ref_count):
							ref = lines[index].split()
							index += 1
							vertex_index = int(ref[0])
							u = float(ref[1]) if len(ref) > 1 else 0.0
							v = float(ref[2]) if len(ref) > 2 else 0.0
							surface["refs"].append((vertex_index, u, v))
						break
				obj.surfaces.append(surface)
		elif key == "kids":
			kids = int(value)
			while stack and kids == 0:
				stack.pop()
				if not stack:
					break
				break
	return [obj for obj in objects if obj.vertices and obj.surfaces]


def ac_position_to_three(position):
	x, y, z = position
	return [x, y, z]


def ac_normal_to_three(normal):
	x, y, z = normal
	return [x, y, z]


def resolve_texture(source_root, asset_source_dir, texture):
	if not texture or texture == EMPTY_TEXTURE:
		return None
	candidates = [
		asset_source_dir / texture,
		source_root / "data/data/textures" / texture,
		source_root / "data/data/objects" / texture,
	]
	for candidate in candidates:
		if candidate.exists():
			return candidate
	return None


def make_material_name(texture):
	return Path(texture).stem if texture else "flat"


def uses_alpha_test(texture):
	name = texture.lower()
	return "tree" in name or "trans-" in name or "arbor" in name


def apply_texture_alpha(material, texture):
	if not texture:
		return
	if uses_alpha_test(texture):
		material["alphaMode"] = "MASK"
		material["alphaCutoff"] = TREE_ALPHA_CUTOFF


def add_accessor(gltf, buffer_views, buffer_parts, component_type, item_type, values, minimum=None, maximum=None):
	offset = sum(len(part) for part in buffer_parts)
	if component_type == 5126:
		payload = b"".join(struct.pack("<f", float(value)) for row in values for value in row)
		byte_stride = None
	elif component_type == 5123:
		payload = b"".join(struct.pack("<H", int(value)) for value in values)
		byte_stride = None
	else:
		raise ValueError("unsupported component type")
	padding = (-len(payload)) % 4
	buffer_parts.append(payload + (b"\0" * padding))
	buffer_views.append({
		"buffer": 0,
		"byteOffset": offset,
		"byteLength": len(payload),
	})
	accessor = {
		"bufferView": len(buffer_views) - 1,
		"componentType": component_type,
		"count": len(values),
		"type": item_type,
	}
	if byte_stride:
		buffer_views[-1]["byteStride"] = byte_stride
	if minimum is not None:
		accessor["min"] = minimum
	if maximum is not None:
		accessor["max"] = maximum
	gltf["accessors"].append(accessor)
	return len(gltf["accessors"]) - 1


def surface_primitive_type(flags):
	return flags & 0x0F


def triangulate_fan(refs):
	if len(refs) < 3:
		return []
	triangles = []
	for i in range(1, len(refs) - 1):
		triangles.append([refs[0], refs[i], refs[i + 1]])
	return triangles


def triangulate_strip(refs):
	if len(refs) < 3:
		return []
	triangles = []
	for i in range(len(refs) - 2):
		if i % 2:
			triangles.append([refs[i + 1], refs[i], refs[i + 2]])
		else:
			triangles.append([refs[i], refs[i + 1], refs[i + 2]])
	return triangles


def triangulate_list(refs):
	if len(refs) < 3:
		return []
	triangles = []
	for i in range(0, len(refs) - 2, 3):
		triangles.append([refs[i], refs[i + 1], refs[i + 2]])
	return triangles


def triangulate_surface(refs, flags):
	primitive_type = surface_primitive_type(flags)
	if primitive_type == AC_SURFACE_FAN:
		return triangulate_fan(refs)
	if primitive_type == AC_SURFACE_TRIANGLE_STRIP:
		return triangulate_strip(refs)
	if primitive_type == AC_SURFACE_TRIANGLES:
		return triangulate_list(refs)
	return []


def convert_ac_to_glb(source_root, source_path, output_path):
	objects = parse_ac3d(source_path)
	primitives = {}
	asset_source_dir = source_path.parent
	texture_sources = {}

	for obj in objects:
		texture = obj.texture
		if texture:
			resolved = resolve_texture(source_root, asset_source_dir, texture)
			if resolved:
				texture_sources[texture] = resolved
			else:
				texture = ""
		key = texture or ""
		target = primitives.setdefault(key, {
			"positions": [],
			"normals": [],
			"uvs": [],
			"indices": [],
			"objects": set(),
		})
		if obj.name:
			target["objects"].add(obj.name)
		for surface in obj.surfaces:
			for triangle in triangulate_surface(surface["refs"], surface["flags"]):
				for vertex_index, u, v in triangle:
					position, normal = obj.vertices[vertex_index]
					target["indices"].append(len(target["positions"]))
					target["positions"].append(ac_position_to_three(position))
					target["normals"].append(ac_normal_to_three(normal))
					target["uvs"].append([u, 1.0 - v])

	gltf = {
		"asset": {"version": "2.0", "generator": "TORCS web asset prototype"},
		"scene": 0,
		"scenes": [{"nodes": [0]}],
		"nodes": [{"mesh": 0, "name": source_path.name}],
		"meshes": [{"name": source_path.stem, "primitives": []}],
		"materials": [],
		"textures": [],
		"images": [],
		"samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
		"buffers": [{"byteLength": 0}],
		"bufferViews": [],
		"accessors": [],
	}
	buffer_parts = []

	for texture, data in sorted(primitives.items(), key=lambda item: item[0]):
		if not data["positions"]:
			continue
		minimum = [min(row[i] for row in data["positions"]) for i in range(3)]
		maximum = [max(row[i] for row in data["positions"]) for i in range(3)]
		position_accessor = add_accessor(gltf, gltf["bufferViews"], buffer_parts, 5126, "VEC3", data["positions"], minimum, maximum)
		normal_accessor = add_accessor(gltf, gltf["bufferViews"], buffer_parts, 5126, "VEC3", data["normals"])
		uv_accessor = add_accessor(gltf, gltf["bufferViews"], buffer_parts, 5126, "VEC2", data["uvs"])
		index_accessor = add_accessor(gltf, gltf["bufferViews"], buffer_parts, 5123, "SCALAR", data["indices"])

		material = {
			"name": make_material_name(texture),
			"pbrMetallicRoughness": {
				"baseColorFactor": [0.72, 0.72, 0.72, 1.0],
				"metallicFactor": 0.0,
				"roughnessFactor": 0.9,
			},
			"doubleSided": True,
		}
		if texture:
			png_name = f"{Path(texture).stem}.png"
			material["pbrMetallicRoughness"]["baseColorTexture"] = {"index": len(gltf["textures"])}
			apply_texture_alpha(material, texture)
			gltf["textures"].append({"sampler": 0, "source": len(gltf["images"])})
			gltf["images"].append({"uri": png_name})
		gltf["materials"].append(material)
		gltf["meshes"][0]["primitives"].append({
			"attributes": {
				"POSITION": position_accessor,
				"NORMAL": normal_accessor,
				"TEXCOORD_0": uv_accessor,
			},
			"indices": index_accessor,
			"material": len(gltf["materials"]) - 1,
		})

	bin_blob = b"".join(buffer_parts)
	gltf["buffers"][0]["byteLength"] = len(bin_blob)
	write_glb(output_path, gltf, bin_blob)
	return {
		"source": str(source_path.relative_to(source_root)),
		"asset": str(output_path),
		"primitives": len(gltf["meshes"][0]["primitives"]),
		"textures": sorted(texture for texture in primitives.keys() if texture),
		"textureSources": texture_sources,
		"objects": sorted({name for data in primitives.values() for name in data["objects"]}),
	}


def write_glb(path, gltf, bin_blob):
	json_blob = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
	json_blob += b" " * ((4 - len(json_blob) % 4) % 4)
	bin_blob += b"\0" * ((4 - len(bin_blob) % 4) % 4)
	total_length = 12 + 8 + len(json_blob) + 8 + len(bin_blob)
	path.parent.mkdir(parents=True, exist_ok=True)
	with path.open("wb") as out:
		out.write(struct.pack("<III", 0x46546C67, 2, total_length))
		out.write(struct.pack("<I4s", len(json_blob), b"JSON"))
		out.write(json_blob)
		out.write(struct.pack("<I4s", len(bin_blob), b"BIN\0"))
		out.write(bin_blob)


def read_sgi_rgb(path):
	data = path.read_bytes()
	if len(data) < 512:
		raise ValueError(f"{path} is too short for SGI RGB")
	magic, storage, bpc, dimension, width, height, channels = struct.unpack(">HBBHHHH", data[:12])
	if magic != 474 or bpc != 1 or channels < 1:
		raise ValueError(f"{path} has unsupported SGI RGB header")

	pixels = bytearray(width * height * 4)
	def set_channel(row, channel, values):
		png_row = height - 1 - row
		for x, value in enumerate(values[:width]):
			pixels[(png_row * width + x) * 4 + channel] = value

	if storage == 0:
		offset = 512
		for channel in range(channels):
			for row in range(height):
				line = data[offset:offset + width]
				offset += width
				set_channel(row, channel, line)
	elif storage == 1:
		table_count = height * channels
		start = [struct.unpack(">I", data[512 + i * 4:516 + i * 4])[0] for i in range(table_count)]
		for channel in range(channels):
			for row in range(height):
				offset = start[channel * height + row]
				values = []
				while offset < len(data) and len(values) < width:
					packet = data[offset]
					offset += 1
					count = packet & 0x7F
					if count == 0:
						break
					if packet & 0x80:
						values.extend(data[offset:offset + count])
						offset += count
					else:
						value = data[offset]
						offset += 1
						values.extend([value] * count)
				set_channel(row, channel, values)
	else:
		raise ValueError(f"{path} has unsupported SGI RGB storage {storage}")

	if channels == 1:
		for offset in range(0, len(pixels), 4):
			pixels[offset + 1] = pixels[offset]
			pixels[offset + 2] = pixels[offset]
			pixels[offset + 3] = 255
	elif channels == 2:
		for offset in range(0, len(pixels), 4):
			pixels[offset + 2] = pixels[offset]
			pixels[offset + 3] = pixels[offset + 1]
	else:
		alpha = channels > 3
		for offset in range(0, len(pixels), 4):
			if not alpha:
				pixels[offset + 3] = 255
	return width, height, bytes(pixels)


def write_png(path, width, height, rgba):
	def chunk(kind, payload):
		return (
			struct.pack(">I", len(payload)) +
			kind +
			payload +
			struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
		)
	raw = b"".join(b"\0" + rgba[row * width * 4:(row + 1) * width * 4] for row in range(height))
	path.parent.mkdir(parents=True, exist_ok=True)
	with path.open("wb") as out:
		out.write(b"\x89PNG\r\n\x1a\n")
		out.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
		out.write(chunk(b"IDAT", zlib.compress(raw, 9)))
		out.write(chunk(b"IEND", b""))


def convert_texture(source, output_dir):
	output = output_dir / f"{source.stem}.png"
	if source.suffix.lower() == ".rgb":
		width, height, rgba = read_sgi_rgb(source)
		write_png(output, width, height, rgba)
	else:
		output.write_bytes(source.read_bytes())
	return output


def relative_to_output(path, output_dir):
	return path.relative_to(output_dir).as_posix()


def main():
	args = parse_args()
	source_root = args.source_root.resolve()
	output_dir = args.output_dir.resolve()
	output_dir.mkdir(parents=True, exist_ok=True)
	clear_generated_output(output_dir)

	track_meta = parse_track_metadata(source_root)
	car_meta = parse_car_metadata(source_root)

	track_dir = output_dir / "tracks/e-track-1"
	track_glb = track_dir / f"{Path(track_meta['model']).stem}.glb"
	track_result = convert_ac_to_glb(
		source_root,
		source_root / "data/tracks/e-track-1" / track_meta["model"],
		track_glb,
	)
	track_texture_outputs = {
		name: relative_to_output(convert_texture(source, track_dir), output_dir)
		for name, source in sorted(track_result["textureSources"].items())
	}
	track_background_output = ""
	track_background_source = resolve_texture(
		source_root,
		source_root / "data/tracks/e-track-1",
		track_meta["background"],
	)
	if track_background_source:
		track_background_output = relative_to_output(convert_texture(track_background_source, track_dir), output_dir)

	car_dir = output_dir / "cars/kc-2000gt"
	car_texture_sources = {}
	for lod in car_meta["lods"]:
		lod_glb = car_dir / f"{Path(lod['model']).stem}.glb"
		result = convert_ac_to_glb(
			source_root,
			source_root / "data/cars/models/kc-2000gt" / lod["model"],
			lod_glb,
		)
		car_texture_sources.update(result["textureSources"])
		lod["asset"] = relative_to_output(lod_glb, output_dir)
		lod["primitiveCount"] = result["primitives"]
		lod["objectNames"] = result["objects"]

	for texture in [car_meta["wheelTexture"], car_meta["shadowTexture"]]:
		resolved = resolve_texture(source_root, source_root / "data/cars/models/kc-2000gt", texture)
		if resolved:
			car_texture_sources[texture] = resolved

	car_texture_outputs = {
		name: relative_to_output(convert_texture(source, car_dir), output_dir)
		for name, source in sorted(car_texture_sources.items())
	}

	manifest = {
		"version": 1,
		"generator": "tools/web-assets/convert_torcs_assets.py",
		"coordinateFrame": {
			"source": "AC3D x, height-y, z",
			"three": "x, height-y, z",
		},
		"tracks": {
			track_meta["xml"]: {
				"name": track_meta["name"],
				"category": track_meta["category"],
				"source": track_result["source"],
				"asset": relative_to_output(track_glb, output_dir),
				"background": track_meta["background"],
				"backgroundType": track_meta["backgroundType"],
				"backgroundTexture": track_background_output,
				"backgroundColor": track_meta["backgroundColor"],
				"ambientColor": track_meta["ambientColor"],
				"diffuseColor": track_meta["diffuseColor"],
				"lightPosition": track_meta["lightPosition"],
				"textures": {name: track_texture_outputs[name] for name in track_result["textures"] if name in track_texture_outputs},
				"primitiveCount": track_result["primitives"],
				"objectNames": track_result["objects"],
			},
		},
		"cars": {
			car_meta["xml"]: {
				"name": car_meta["name"],
				"wheelTexture": car_meta["wheelTexture"],
				"shadowTexture": car_meta["shadowTexture"],
				"wheelFallback": {
					"source": "runtime-snapshot",
					"texture": car_meta["wheelTexture"],
					"radiusScale": 1.0,
					"widthScale": 1.0,
				},
				"lods": car_meta["lods"],
				"textures": {
					name: car_texture_outputs[name]
					for name in [car_meta["wheelTexture"], car_meta["shadowTexture"], "kc-2000gt.rgb"]
					if name in car_texture_outputs
				},
			},
		},
	}
	(output_dir / "manifest.json").write_text(json.dumps(manifest, indent="\t") + "\n", encoding="utf-8")
	texture_outputs = set(track_texture_outputs.values()) | set(car_texture_outputs.values())
	if track_background_output:
		texture_outputs.add(track_background_output)
	print(json.dumps({
		"manifest": relative_to_output(output_dir / "manifest.json", output_dir),
		"track": manifest["tracks"][track_meta["xml"]]["asset"],
		"carLods": len(car_meta["lods"]),
		"textures": len(texture_outputs),
	}))


if __name__ == "__main__":
	main()
