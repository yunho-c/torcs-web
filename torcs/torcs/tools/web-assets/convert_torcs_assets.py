#!/usr/bin/env python3
"""Convert TORCS browser renderer assets to web-native files."""

import argparse
import json
import re
import shutil
import struct
import sys
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree


GOLDEN_TRACK_XML = Path("data/tracks/e-track-1/e-track-1.xml")
GOLDEN_CAR_XML = Path("data/cars/models/kc-2000gt/kc-2000gt.xml")
EMPTY_TEXTURE = "empty_texture_no_mapping"
AC_SURFACE_FAN = 0
AC_SURFACE_LINE_LOOP = 1
AC_SURFACE_LINE_STRIP = 2
AC_SURFACE_TRIANGLES = 3
AC_SURFACE_TRIANGLE_STRIP = 4
TREE_ALPHA_CUTOFF = 0.65
TEXTURE_ALPHA_CUTOFF = 0.10
BLENDED_ALPHA_MATERIAL_CLASSES = {"glass", "mirrorGlass"}
EFFECT_TEXTURES = [
	"smoke.rgb",
	"fire0.rgb",
	"fire1.rgb",
	"frontlight1.rgb",
	"frontlight2.rgb",
	"rearlight1.rgb",
	"rearlight2.rgb",
	"breaklight1.rgb",
	"breaklight2.rgb",
	"grey-tracks.rgb",
]
GLOBAL_SOUND_SAMPLES = {
	"skidTyres": "skid_tyres.wav",
	"roadRide": "road-ride.wav",
	"grassRide": "out_of_road.wav",
	"curbRide": "curb_ride.wav",
	"grassSkid": "out_of_road-3.wav",
	"metalSkid": "skid_metal.wav",
	"axle": "axle.wav",
	"turbo": "turbo1.wav",
	"backfireLoop": "backfire_loop.wav",
	"backfire": "backfire.wav",
	"bang": "boom.wav",
	"bottomCrash": "bottom_crash.wav",
	"gearChange": "gear_change1.wav",
}
CRASH_SOUND_SAMPLES = [f"crash{i}.wav" for i in range(1, 7)]
CAR_MIRROR_GLASS_PATTERNS = ["MIRRORGLASS", "MIRRORGLAS"]
CAR_GLASS_PATTERNS = ["WINDOW", "WIND", "WIFRONT", "WIREAR", "WISIDE"]
CAR_GLASS_PREFIXES = ["WI_", "WI2", "WI3"]
CAR_HEADLAMP_PATTERNS = [
	"FRONTLIGHT",
	"FRONLIGHT",
	"MAINLIGHT",
	"WIMAINLIGHT",
	"WIFRONTLIGHT",
	"WIFRONTLIGH",
	"HEADLIGHT",
	"LIGHTBULP",
]
CAR_TAILLAMP_PATTERNS = [
	"REARLIGHT",
	"TAILLIGHT",
	"WILIGHTREAR",
	"WIREARLIGHT",
	"LIGHTREAR",
	"BRAKELIGHT",
]
CAR_EXHAUST_PATTERNS = ["EXHAUST", "EXHAUS", "MUFFLER", "EXHAUSTPIPE"]
CAR_BLACK_TRIM_PATTERNS = ["WIPER", "ANTENNA"]
CAR_INTERIOR_PATTERNS = [
	"COCKPIT",
	"CONSOLE",
	"DASH",
	"DASHBOARD",
	"STEERING",
	"STEERW",
	"SEAT",
	"ROLLBAR",
]
CAR_DRIVER_PATTERNS = ["DRIVER", "GIRTHS"]
CAR_LIGHT_TYPES = {"head1", "head2", "rear", "brake", "brake2"}
WHEEL_TIRE_PATTERNS = ["TIRE", "TYRE", "DRIVINGCOLL"]
WHEEL_RIM_PATTERNS = ["RIM", "WIRIM", "WI_"]
WHEEL_BRAKE_PATTERNS = ["BRAKE", "BRK", "DISC", "DISK", "CALIPER"]
TRACK_ROAD_TEXTURE_PATTERNS = ["ROAD", "TARMAC", "ASPHALT", "TRKASPH", "TRKROAD"]
TRACK_GRASS_TEXTURE_PATTERNS = ["GRASS", "GRAS", "LAWN"]
TRACK_SAND_TEXTURE_PATTERNS = ["SAND", "GRAVEL", "DIRT", "MUD"]
TRACK_CURB_TEXTURE_PATTERNS = ["CURB", "KERB", "CURBS", "KERBS", "RUMBLE"]
TRACK_BARRIER_TEXTURE_PATTERNS = ["BARRIER", "ARMCO", "GUARDRAIL", "RAIL", "WALL", "BAR-"]
TRACK_TIRE_WALL_TEXTURE_PATTERNS = ["TIREWALL", "TYREWALL", "TIRE", "TYRE"]
TRACK_TREE_TEXTURE_PATTERNS = ["TREE", "ARBOR", "ARBRE"]
TRACK_CONCRETE_TEXTURE_PATTERNS = ["CONCRETE", "CONC", "CEMENT", "CMNT"]
TRACK_BUILDING_TEXTURE_PATTERNS = ["BUILD", "BLDG", "HOUSE", "ROOF", "PIT", "STAND", "TRIB"]
TRACK_FENCE_TEXTURE_PATTERNS = ["FENCE", "FENC", "WIRE", "MESH", "NET"]
TRACK_SIGN_TEXTURE_PATTERNS = ["SIGN", "ADVER", "BANNER", "PANEL", "BILLBOARD", "SEMA"]
TRACK_TERRAIN_OBJECT_PREFIXES = ["TERR", "TKLS", "TKRS", "T0LB", "T0RB"]
TRACK_BARRIER_OBJECT_PREFIXES = ["B0LT", "B0RT", "B1LT", "B1RT", "B2LT", "B2RT", "BRLT", "BRRT"]
TRACK_TREE_OBJECT_PREFIXES = ["TREE", "ARB"]
WHEEL_SECTIONS = [
	("Front Right Wheel", "Front Axle", "Front Right Suspension"),
	("Front Left Wheel", "Front Axle", "Front Left Suspension"),
	("Rear Right Wheel", "Rear Axle", "Rear Right Suspension"),
	("Rear Left Wheel", "Rear Axle", "Rear Left Suspension"),
]


@dataclass
class AcObject:
	name: str = ""
	texture: str = ""
	texture_layers: dict = field(default_factory=dict)
	vertices: list = field(default_factory=list)
	surfaces: list = field(default_factory=list)


@dataclass(frozen=True)
class TextureAlphaInfo:
	has_alpha: bool = False
	has_transparent_alpha: bool = False
	has_partial_alpha: bool = False


def parse_args(argv=None):
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--source-root", type=Path, required=True)
	parser.add_argument("--output-dir", type=Path, required=True)
	parser.add_argument(
		"--quick",
		action="store_true",
		help="convert only the golden E-Track 1/kc-2000gt web asset pair",
	)
	parser.add_argument(
		"--profile",
		action="store_true",
		help="profile the conversion with pyinstrument and write an HTML report",
	)
	parser.add_argument(
		"--profile-output",
		type=Path,
		help="path for the pyinstrument HTML report; defaults to <output-dir>/convert-profile.html",
	)
	return parser.parse_args(argv)


def clear_generated_output(output_dir):
	for name in ("tracks", "cars", "effects", "audio", "manifest.json"):
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
	text = re.sub(r"&(?!(?:amp|lt|gt|apos|quot);)[A-Za-z0-9_.-]+;", "", text)
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


def attnum_si(section, name, default=0.0):
	for child in section:
		if child.tag == "attnum" and child.attrib.get("name") == name:
			value = float(child.attrib.get("val", default))
			unit = child.attrib.get("unit", "")
			if unit == "mm":
				return value / 1000.0
			if unit == "cm":
				return value / 100.0
			if unit == "in":
				return value * 0.0254
			if unit == "ft":
				return value * 0.3048
			if unit == "%":
				return value / 100.0
			return value
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


def runtime_path(path):
	return path.as_posix()


def discover_track_xmls(source_root):
	return sorted(
		path.relative_to(source_root)
		for path in (source_root / "data/tracks").rglob("*.xml")
		if ".prj" not in path.name
	)


def discover_car_xmls(source_root):
	return sorted(
		path.relative_to(source_root)
		for path in (source_root / "data/cars/models").glob("*/*.xml")
		if path.stem == path.parent.name
	)


def selected_asset_paths(source_root, quick):
	if quick:
		return [GOLDEN_TRACK_XML], [GOLDEN_CAR_XML]
	return discover_track_xmls(source_root), discover_car_xmls(source_root)


def parse_track_metadata(source_root, track_xml):
	root = ElementTree.fromstring(clean_xml(source_root / track_xml))
	header = find_section(root, "Header")
	graphic = find_section(root, "Graphic")
	return {
		"xml": runtime_path(track_xml),
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
		"specularColor": [
			attnum(graphic, "specular color R", 0.3),
			attnum(graphic, "specular color G", 0.3),
			attnum(graphic, "specular color B", 0.3),
		],
		"shininess": attnum(graphic, "shininess", 50.0),
		"lightPosition": [
			attnum(graphic, "light position x", 0.0),
			attnum(graphic, "light position y", 10000.0),
			attnum(graphic, "light position z", 3000.0),
		],
	}


def parse_car_lights(objects):
	lights = find_section(objects, "Light") if objects is not None else None
	if lights is None:
		return []
	result = []
	for child in lights:
		if child.tag != "section":
			continue
		light_type = attstr(child, "type")
		if light_type not in CAR_LIGHT_TYPES:
			continue
		result.append({
			"type": light_type,
			"position": [
				attnum(child, "xpos"),
				attnum(child, "ypos"),
				attnum(child, "zpos"),
			],
			"size": attnum(child, "size", 0.2),
		})
	return result


def parse_car_wheel_layout(root):
	wheels = []
	for wheel_name, axle_name, suspension_name in WHEEL_SECTIONS:
		wheel = find_section(root, wheel_name)
		axle = find_section(root, axle_name)
		if wheel is None or axle is None:
			return []
		suspension = find_section(root, suspension_name)
		xpos = attnum_si(axle, "xpos")
		ypos = attnum_si(wheel, "ypos")
		rim_diameter = attnum_si(wheel, "rim diameter", 0.33)
		tire_width = attnum_si(wheel, "tire width", 0.145)
		tire_ratio = attnum_si(wheel, "tire height-width ratio", 0.75)
		packers = attnum_si(suspension, "packers") if suspension is not None else 0.0
		bellcrank = attnum_si(suspension, "bellcrank", 1.0) if suspension is not None else 1.0
		radius = rim_diameter / 2.0 + tire_width * tire_ratio
		center_z = radius - packers / max(bellcrank, 0.0001)
		wheels.append({
			"section": wheel_name,
			"position": [xpos, ypos, center_z],
			"radius": radius,
			"width": tire_width,
		})
	return wheels


def parse_car_metadata(source_root, car_xml):
	root = ElementTree.fromstring(clean_xml(source_root / car_xml))
	objects = find_section(root, "Graphic Objects")
	ranges = find_section(objects, "Ranges")
	sound = find_section(root, "Sound")
	engine = find_section(root, "Engine")
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
		"id": car_xml.parent.name,
		"xml": runtime_path(car_xml),
		"name": root.attrib.get("name", car_xml.parent.name),
		"wheelTexture": attstr(objects, "wheel texture"),
		"wheel3dBasename": attstr(objects, "3d wheel basename"),
		"wheel3dDirectory": attstr(objects, "3d wheel directory"),
		"wheelLayout": parse_car_wheel_layout(root),
		"shadowTexture": attstr(objects, "shadow texture"),
		"lights": parse_car_lights(objects),
		"sound": {
			"engineSample": attstr(sound, "engine sample", "engine-1.wav") if sound is not None else "engine-1.wav",
			"rpmScale": attnum(sound, "rpm scale", 1.0) if sound is not None else 1.0,
			"turbo": attstr(engine, "turbo", "false") == "true" if engine is not None else False,
			"turboRpm": attnum(engine, "turbo rpm", 100.0) if engine is not None else 100.0,
			"turboLag": attnum(engine, "turbo lag", 1.0) if engine is not None else 1.0,
		},
		"lods": lods,
	}


def parse_texture_declaration(value):
	parts = value.split()
	if not parts:
		return "", "base"
	texture = parts[0].strip('"')
	layer = parts[1].lower() if len(parts) > 1 else "base"
	return texture, layer


def make_surface_ref(parts):
	vertex_index = int(parts[0])
	uvs = []
	for index in range(1, len(parts) - 1, 2):
		uvs.append((float(parts[index]), float(parts[index + 1])))
	if not uvs:
		uvs.append((0.0, 0.0))
	return vertex_index, tuple(uvs)


def ref_vertex_index(ref):
	return ref[0]


def ref_uv(ref, layer_index=0):
	if len(ref) >= 3 and isinstance(ref[1], float):
		return ref[1], ref[2]
	uvs = ref[1]
	if layer_index < len(uvs):
		return uvs[layer_index]
	if uvs:
		return uvs[0]
	return 0.0, 0.0


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
		elif key == "texture":
			tex, layer = parse_texture_declaration(value)
			if tex != EMPTY_TEXTURE:
				obj.texture_layers[layer] = tex
				if layer == "base" and not obj.texture:
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
							surface["refs"].append(make_surface_ref(ref))
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


def make_material_name(texture, material_class=""):
	texture_name = Path(texture).stem if texture else "flat"
	return f"{texture_name}-{material_class}" if material_class else texture_name


def make_shadow_overlay_texture_name(texture):
	return f"{Path(texture).stem}-shadow-overlay.png"


def make_skid_overlay_texture_name(texture):
	return f"{Path(texture).stem}-skid-overlay.png"


def is_track_shadow_overlay_texture(texture):
	return bool(texture) and Path(texture).stem.lower().startswith("shadow")


def uses_alpha_test(texture):
	name = texture.lower()
	return "tree" in name or "trans-" in name or "arbor" in name


def skips_track_shadow_overlay(material_class, texture):
	return material_class == "treeFoliage" or uses_alpha_test(texture or "")


def alpha_info_from_rgba(rgba):
	has_transparent_alpha = False
	has_partial_alpha = False
	for offset in range(3, len(rgba), 4):
		alpha = rgba[offset]
		if alpha < 255:
			if alpha == 0:
				has_transparent_alpha = True
			else:
				has_partial_alpha = True
	return TextureAlphaInfo(
		has_alpha=has_transparent_alpha or has_partial_alpha,
		has_transparent_alpha=has_transparent_alpha,
		has_partial_alpha=has_partial_alpha,
	)


def read_texture_alpha_info(path):
	suffix = path.suffix.lower()
	if suffix == ".rgb":
		_, _, rgba = read_sgi_rgb(path)
		return alpha_info_from_rgba(rgba)
	if suffix == ".png":
		_, _, rgba = read_png_rgba(path)
		return alpha_info_from_rgba(rgba)
	return TextureAlphaInfo()


def probe_texture_alpha_info(path):
	try:
		return read_texture_alpha_info(path)
	except (OSError, ValueError, zlib.error, struct.error):
		return TextureAlphaInfo()


def apply_texture_alpha(material, texture, material_class="", alpha_info=None):
	if not texture:
		return
	alpha_info = alpha_info or TextureAlphaInfo()
	if alpha_info.has_alpha and material_class in BLENDED_ALPHA_MATERIAL_CLASSES:
		material["alphaMode"] = "BLEND"
		return
	if uses_alpha_test(texture):
		material["alphaMode"] = "MASK"
		material["alphaCutoff"] = TREE_ALPHA_CUTOFF
	elif alpha_info.has_alpha:
		material["alphaMode"] = "MASK"
		material["alphaCutoff"] = TEXTURE_ALPHA_CUTOFF


def contains_any(text, patterns):
	return any(pattern in text for pattern in patterns)


def starts_with_any(text, prefixes):
	return any(text.startswith(prefix) for prefix in prefixes)


def classify_car_object(name, texture=""):
	upper = name.upper()
	texture_upper = texture.upper()
	if contains_any(upper, CAR_MIRROR_GLASS_PATTERNS):
		return "mirrorGlass"
	if contains_any(upper, CAR_TAILLAMP_PATTERNS):
		return "taillamp"
	if contains_any(upper, CAR_HEADLAMP_PATTERNS):
		return "headlamp"
	if contains_any(upper, CAR_GLASS_PATTERNS) or starts_with_any(upper, CAR_GLASS_PREFIXES):
		return "glass"
	if contains_any(upper, CAR_EXHAUST_PATTERNS):
		return "exhaust"
	if contains_any(upper, CAR_BLACK_TRIM_PATTERNS) or "CARBON" in texture_upper:
		return "blackTrim"
	if contains_any(upper, CAR_INTERIOR_PATTERNS):
		return "interior"
	if contains_any(upper, CAR_DRIVER_PATTERNS) or texture_upper == "DRIVER.RGB":
		return "driver"
	return "body"


def classify_track_object(name, texture=""):
	upper = name.upper()
	texture_upper = texture.upper()
	texture_stem = Path(texture_upper).stem
	if contains_any(texture_upper, TRACK_TREE_TEXTURE_PATTERNS) or starts_with_any(upper, TRACK_TREE_OBJECT_PREFIXES):
		return "treeFoliage"
	if contains_any(texture_upper, TRACK_TIRE_WALL_TEXTURE_PATTERNS):
		return "tireWall"
	if contains_any(texture_upper, TRACK_CURB_TEXTURE_PATTERNS):
		return "curb"
	if (
		contains_any(texture_upper, TRACK_BARRIER_TEXTURE_PATTERNS) or
		texture_stem in {"TR-BAR", "TR-BARRIER", "TR-BARRIER-BW", "TR-BARRIER-BW2"} or
		starts_with_any(upper, TRACK_BARRIER_OBJECT_PREFIXES)
	):
		return "barrier"
	if contains_any(texture_upper, TRACK_FENCE_TEXTURE_PATTERNS):
		return "fence"
	if contains_any(texture_upper, TRACK_SIGN_TEXTURE_PATTERNS):
		return "sign"
	if contains_any(texture_upper, TRACK_BUILDING_TEXTURE_PATTERNS):
		return "building"
	if contains_any(texture_upper, TRACK_CONCRETE_TEXTURE_PATTERNS):
		return "concrete"
	if contains_any(texture_upper, TRACK_ROAD_TEXTURE_PATTERNS):
		return "road"
	if contains_any(texture_upper, TRACK_GRASS_TEXTURE_PATTERNS):
		return "grass"
	if contains_any(texture_upper, TRACK_SAND_TEXTURE_PATTERNS):
		return "sand"
	if starts_with_any(upper, TRACK_TERRAIN_OBJECT_PREFIXES):
		return "terrain"
	return ""


def classify_wheel_object(name, texture=""):
	upper = name.upper()
	texture_upper = texture.upper()
	if contains_any(upper, WHEEL_BRAKE_PATTERNS) or contains_any(texture_upper, WHEEL_BRAKE_PATTERNS):
		return "wheelBrake"
	if contains_any(upper, WHEEL_TIRE_PATTERNS) or contains_any(texture_upper, ["TIRE", "TYRE"]):
		return "wheelTire"
	if contains_any(upper, WHEEL_RIM_PATTERNS) or contains_any(texture_upper, ["RIM", "WHEEL3D"]):
		return "wheelRim"
	return "wheelTire"


def make_primitive_key(texture, material_class):
	return texture or "", material_class or ""


def make_overlay_primitive_key(texture, material_class, layer, role):
	return "overlay", texture or "", material_class or "", layer, role


def add_accessor(gltf, buffer_views, buffer_parts, component_type, item_type, values, minimum=None, maximum=None):
	offset = sum(len(part) for part in buffer_parts)
	if component_type == 5126:
		payload = b"".join(struct.pack("<f", float(value)) for row in values for value in row)
		byte_stride = None
	elif component_type == 5123:
		payload = b"".join(struct.pack("<H", int(value)) for value in values)
		byte_stride = None
	elif component_type == 5125:
		payload = b"".join(struct.pack("<I", int(value)) for value in values)
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


def add_triangle_to_primitive(target, obj, triangle, texture_layer=0, normal_offset=0.0):
	if obj.name:
		target["objects"].add(obj.name)
	for ref in triangle:
		vertex_index = ref_vertex_index(ref)
		u, v = ref_uv(ref, texture_layer)
		position, normal = obj.vertices[vertex_index]
		if normal_offset:
			position = [
				position[0] + normal[0] * normal_offset,
				position[1] + normal[1] * normal_offset,
				position[2] + normal[2] * normal_offset,
			]
		target["indices"].append(len(target["positions"]))
		target["positions"].append(ac_position_to_three(position))
		target["normals"].append(ac_normal_to_three(normal))
		target["uvs"].append([u, 1.0 - v])


def convert_ac_to_glb(source_root, source_path, output_path, object_classifier=None, include_track_shadow_overlays=False, include_track_skid_overlays=False):
	objects = parse_ac3d(source_path)
	primitives = {}
	asset_source_dir = source_path.parent
	texture_sources = {}
	texture_alpha_infos = {}
	shadow_overlay_sources = {}
	skid_overlay_sources = {}

	for obj in objects:
		texture = obj.texture
		material_class = object_classifier(obj.name, obj.texture) if object_classifier else ""
		if texture:
			resolved = resolve_texture(source_root, asset_source_dir, texture)
			if resolved:
				texture_sources[texture] = resolved
				if texture not in texture_alpha_infos:
					texture_alpha_infos[texture] = probe_texture_alpha_info(resolved)
			else:
				texture = ""
		key = make_primitive_key(texture, material_class)
		target = primitives.setdefault(key, {
			"texture": texture or "",
			"materialClass": material_class,
			"role": "base",
			"layer": "base",
			"imageUri": f"{Path(texture).stem}.png" if texture else "",
			"sourceTexture": texture or "",
			"positions": [],
			"normals": [],
			"uvs": [],
			"indices": [],
			"objects": set(),
		})
		shadow_texture = obj.texture_layers.get("tiled", "")
		shadow_target = None
		if (
			include_track_shadow_overlays and
			is_track_shadow_overlay_texture(shadow_texture) and
			not skips_track_shadow_overlay(material_class, obj.texture)
		):
			resolved_shadow = resolve_texture(source_root, asset_source_dir, shadow_texture)
			if resolved_shadow:
				shadow_overlay_sources[shadow_texture] = resolved_shadow
				shadow_key = make_overlay_primitive_key(shadow_texture, material_class, "tiled", "trackShadow")
				shadow_target = primitives.setdefault(shadow_key, {
					"texture": shadow_texture,
					"materialClass": material_class,
					"role": "trackShadow",
					"layer": "tiled",
					"imageUri": make_shadow_overlay_texture_name(shadow_texture),
					"sourceTexture": shadow_texture,
					"positions": [],
					"normals": [],
					"uvs": [],
					"indices": [],
					"objects": set(),
				})
		skid_texture = obj.texture_layers.get("skids", "")
		skid_target = None
		if include_track_skid_overlays and skid_texture:
			resolved_skid = resolve_texture(source_root, asset_source_dir, skid_texture)
			if resolved_skid:
				skid_overlay_sources[skid_texture] = resolved_skid
				skid_key = make_overlay_primitive_key(skid_texture, material_class, "skids", "trackSkid")
				skid_target = primitives.setdefault(skid_key, {
					"texture": skid_texture,
					"materialClass": material_class,
					"role": "trackSkid",
					"layer": "skids",
					"imageUri": make_skid_overlay_texture_name(skid_texture),
					"sourceTexture": skid_texture,
					"positions": [],
					"normals": [],
					"uvs": [],
					"indices": [],
					"objects": set(),
				})
		for surface in obj.surfaces:
			for triangle in triangulate_surface(surface["refs"], surface["flags"]):
				add_triangle_to_primitive(target, obj, triangle)
				if shadow_target:
					add_triangle_to_primitive(shadow_target, obj, triangle, texture_layer=1, normal_offset=0.01)
				if skid_target:
					add_triangle_to_primitive(skid_target, obj, triangle, texture_layer=2, normal_offset=0.015)

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
	texture_indices = {}

	for _, data in sorted(primitives.items(), key=lambda item: item[0]):
		if not data["positions"]:
			continue
		texture = data["texture"]
		material_class = data["materialClass"]
		role = data["role"]
		minimum = [min(row[i] for row in data["positions"]) for i in range(3)]
		maximum = [max(row[i] for row in data["positions"]) for i in range(3)]
		position_accessor = add_accessor(gltf, gltf["bufferViews"], buffer_parts, 5126, "VEC3", data["positions"], minimum, maximum)
		normal_accessor = add_accessor(gltf, gltf["bufferViews"], buffer_parts, 5126, "VEC3", data["normals"])
		uv_accessor = add_accessor(gltf, gltf["bufferViews"], buffer_parts, 5126, "VEC2", data["uvs"])
		index_component_type = 5125 if max(data["indices"]) > 65535 else 5123
		index_accessor = add_accessor(gltf, gltf["bufferViews"], buffer_parts, index_component_type, "SCALAR", data["indices"])

		material = {
			"name": make_material_name(texture, material_class),
			"pbrMetallicRoughness": {
				"baseColorFactor": [1.0, 1.0, 1.0, 1.0],
				"metallicFactor": 0.0,
				"roughnessFactor": 0.9,
			},
			"doubleSided": True,
		}
		material["extras"] = {
			"torcsSourceTexture": data["sourceTexture"],
			"torcsObjectNames": sorted(data["objects"]),
		}
		if material_class:
			material["extras"]["torcsMaterialClass"] = material_class
		if role != "base":
			material["name"] = f"{Path(texture).stem}-{role}"
			material["extras"]["torcsOverlayRole"] = role
			material["extras"]["torcsOverlayLayer"] = data["layer"]
		if texture:
			image_uri = data["imageUri"]
			if image_uri not in texture_indices:
				texture_indices[image_uri] = len(gltf["textures"])
				gltf["textures"].append({"sampler": 0, "source": len(gltf["images"])})
				gltf["images"].append({"uri": image_uri})
			material["pbrMetallicRoughness"]["baseColorTexture"] = {"index": texture_indices[image_uri]}
			apply_texture_alpha(material, texture, material_class, texture_alpha_infos.get(texture))
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
		"textures": sorted({data["texture"] for data in primitives.values() if data["texture"] and data["role"] == "base"}),
		"textureSources": texture_sources,
		"shadowOverlayTextureSources": shadow_overlay_sources,
		"skidOverlayTextureSources": skid_overlay_sources,
		"trackShadowOverlays": [
			{
				"sourceTexture": data["sourceTexture"],
				"layer": data["layer"],
				"role": data["role"],
				"primitiveCount": len(data["indices"]) // 3,
				"objectNames": sorted(data["objects"]),
			}
			for _, data in sorted(primitives.items(), key=lambda item: item[0])
			if data["positions"] and data["role"] == "trackShadow"
		],
		"trackSkidOverlays": [
			{
				"sourceTexture": data["sourceTexture"],
				"layer": data["layer"],
				"role": data["role"],
				"primitiveCount": len(data["indices"]) // 3,
				"objectNames": sorted(data["objects"]),
			}
			for _, data in sorted(primitives.items(), key=lambda item: item[0])
			if data["positions"] and data["role"] == "trackSkid"
		],
		"objects": sorted({name for data in primitives.values() for name in data["objects"]}),
		"materials": [
			{
				"class": data["materialClass"],
				"texture": data["texture"],
				"objectNames": sorted(data["objects"]),
			}
			for _, data in sorted(primitives.items(), key=lambda item: item[0])
			if data["positions"] and data["materialClass"] and data["role"] == "base"
		],
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


def paeth_predictor(left, up, upper_left):
	p = left + up - upper_left
	pa = abs(p - left)
	pb = abs(p - up)
	pc = abs(p - upper_left)
	if pa <= pb and pa <= pc:
		return left
	if pb <= pc:
		return up
	return upper_left


def unfilter_png_scanlines(path, data, width, height, bytes_per_pixel, row_bytes):
	rows = []
	offset = 0
	previous = bytearray(row_bytes)
	for _ in range(height):
		if offset + 1 + row_bytes > len(data):
			raise ValueError(f"{path} has truncated PNG scanline data")
		filter_type = data[offset]
		offset += 1
		row = bytearray(data[offset:offset + row_bytes])
		offset += row_bytes
		for i, value in enumerate(row):
			left = row[i - bytes_per_pixel] if i >= bytes_per_pixel else 0
			up = previous[i]
			upper_left = previous[i - bytes_per_pixel] if i >= bytes_per_pixel else 0
			if filter_type == 0:
				continue
			if filter_type == 1:
				row[i] = (value + left) & 0xFF
			elif filter_type == 2:
				row[i] = (value + up) & 0xFF
			elif filter_type == 3:
				row[i] = (value + ((left + up) // 2)) & 0xFF
			elif filter_type == 4:
				row[i] = (value + paeth_predictor(left, up, upper_left)) & 0xFF
			else:
				raise ValueError(f"{path} has unsupported PNG filter {filter_type}")
		rows.append(bytes(row))
		previous = row
	return rows


def read_png_rgba(path):
	data = path.read_bytes()
	if data[:8] != b"\x89PNG\r\n\x1a\n":
		raise ValueError(f"{path} is not a PNG file")
	offset = 8
	width = height = bit_depth = color_type = interlace = None
	idat = bytearray()
	while offset + 8 <= len(data):
		length = struct.unpack(">I", data[offset:offset + 4])[0]
		kind = data[offset + 4:offset + 8]
		payload = data[offset + 8:offset + 8 + length]
		offset += 12 + length
		if kind == b"IHDR":
			width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(">IIBBBBB", payload)
			if compression != 0 or filter_method != 0 or interlace != 0:
				raise ValueError(f"{path} has unsupported PNG header")
		elif kind == b"IDAT":
			idat.extend(payload)
		elif kind == b"IEND":
			break
	if width is None or height is None:
		raise ValueError(f"{path} missing PNG IHDR")
	if bit_depth != 8:
		raise ValueError(f"{path} has unsupported PNG bit depth {bit_depth}")
	channels_by_color_type = {0: 1, 2: 3, 4: 2, 6: 4}
	if color_type not in channels_by_color_type:
		raise ValueError(f"{path} has unsupported PNG color type {color_type}")
	channels = channels_by_color_type[color_type]
	row_bytes = width * channels
	rows = unfilter_png_scanlines(path, zlib.decompress(bytes(idat)), width, height, channels, row_bytes)
	pixels = bytearray(width * height * 4)
	for y, row in enumerate(rows):
		for x in range(width):
			source = x * channels
			target = (y * width + x) * 4
			if color_type == 0:
				value = row[source]
				pixels[target:target + 4] = bytes([value, value, value, 255])
			elif color_type == 2:
				pixels[target:target + 4] = bytes([row[source], row[source + 1], row[source + 2], 255])
			elif color_type == 4:
				value = row[source]
				pixels[target:target + 4] = bytes([value, value, value, row[source + 1]])
			elif color_type == 6:
				pixels[target:target + 4] = row[source:source + 4]
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


def make_shadow_overlay_rgba(rgba):
	overlay = bytearray(len(rgba))
	for offset in range(0, len(rgba), 4):
		luminance = int(round(
			rgba[offset] * 0.2126 +
			rgba[offset + 1] * 0.7152 +
			rgba[offset + 2] * 0.0722
		))
		overlay[offset] = 0
		overlay[offset + 1] = 0
		overlay[offset + 2] = 0
		source_alpha = rgba[offset + 3]
		overlay_alpha = max(0, min(255, 255 - luminance))
		overlay[offset + 3] = round(overlay_alpha * source_alpha / 255)
	return bytes(overlay)


def convert_texture(source, output_dir):
	output = output_dir / f"{source.stem}.png"
	if source.suffix.lower() == ".rgb":
		width, height, rgba = read_sgi_rgb(source)
		write_png(output, width, height, rgba)
	else:
		output.parent.mkdir(parents=True, exist_ok=True)
		output.write_bytes(source.read_bytes())
	return output


def convert_shadow_overlay_texture(source, output_dir):
	output = output_dir / make_shadow_overlay_texture_name(source.name)
	if source.suffix.lower() == ".rgb":
		width, height, rgba = read_sgi_rgb(source)
		write_png(output, width, height, make_shadow_overlay_rgba(rgba))
	else:
		output.parent.mkdir(parents=True, exist_ok=True)
		output.write_bytes(source.read_bytes())
	return output


def convert_skid_overlay_texture(source, output_dir):
	output = output_dir / make_skid_overlay_texture_name(source.name)
	if source.suffix.lower() == ".rgb":
		width, height, rgba = read_sgi_rgb(source)
		write_png(output, width, height, make_shadow_overlay_rgba(rgba))
	elif source.suffix.lower() == ".png":
		width, height, rgba = read_png_rgba(source)
		write_png(output, width, height, make_shadow_overlay_rgba(rgba))
	else:
		output.parent.mkdir(parents=True, exist_ok=True)
		output.write_bytes(source.read_bytes())
	return output


def resolve_engine_sample(source_root, car_name, sample):
	candidates = [
		source_root / "data/cars/models" / car_name / sample,
		source_root / "data/data/sound" / sample,
	]
	for candidate in candidates:
		if candidate.exists():
			return candidate
	raise FileNotFoundError(f"could not resolve engine sample {sample} for {car_name}")


def copy_audio_sample(source, output_dir):
	output_dir.mkdir(parents=True, exist_ok=True)
	output = output_dir / source.name
	shutil.copy2(source, output)
	return output


def resolve_material_mask(source_root, car_name):
	path = source_root / "data/cars/models" / car_name / f"{car_name}-material-mask.png"
	return path if path.exists() else None


def relative_to_output(path, output_dir):
	return path.relative_to(output_dir).as_posix()


def track_output_dir(output_dir, track_xml):
	track_relative = track_xml.relative_to("data/tracks").parent
	return output_dir / "tracks" / track_relative


def convert_track(source_root, output_dir, track_xml):
	track_meta = parse_track_metadata(source_root, track_xml)
	track_source_dir = source_root / track_xml.parent
	track_dir = track_output_dir(output_dir, track_xml)
	track_glb = track_dir / f"{Path(track_meta['model']).stem}.glb"
	track_result = convert_ac_to_glb(
		source_root,
		track_source_dir / track_meta["model"],
		track_glb,
		classify_track_object,
		include_track_shadow_overlays=True,
		include_track_skid_overlays=True,
	)
	track_texture_outputs = {
		name: relative_to_output(convert_texture(source, track_dir), output_dir)
		for name, source in sorted(track_result["textureSources"].items())
	}
	track_shadow_overlay_outputs = {
		name: relative_to_output(convert_shadow_overlay_texture(source, track_dir), output_dir)
		for name, source in sorted(track_result["shadowOverlayTextureSources"].items())
	}
	track_skid_overlay_outputs = {
		name: relative_to_output(convert_skid_overlay_texture(source, track_dir), output_dir)
		for name, source in sorted(track_result["skidOverlayTextureSources"].items())
	}
	track_background_output = ""
	track_background_source = resolve_texture(
		source_root,
		track_source_dir,
		track_meta["background"],
	)
	if track_background_source:
		track_background_output = relative_to_output(convert_texture(track_background_source, track_dir), output_dir)

	entry = {
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
		"specularColor": track_meta["specularColor"],
		"shininess": track_meta["shininess"],
		"lightPosition": track_meta["lightPosition"],
		"textures": {name: track_texture_outputs[name] for name in track_result["textures"] if name in track_texture_outputs},
		"trackShadowOverlays": [
			{
				**overlay,
				"texture": track_shadow_overlay_outputs.get(overlay["sourceTexture"], ""),
			}
			for overlay in track_result["trackShadowOverlays"]
		],
		"trackSkidOverlays": [
			{
				**overlay,
				"texture": track_skid_overlay_outputs.get(overlay["sourceTexture"], ""),
			}
			for overlay in track_result["trackSkidOverlays"]
		],
		"primitiveCount": track_result["primitives"],
		"objectNames": track_result["objects"],
		"materialClasses": sorted({material["class"] for material in track_result["materials"]}),
		"materials": track_result["materials"],
	}
	texture_outputs = set(track_texture_outputs.values())
	texture_outputs.update(track_shadow_overlay_outputs.values())
	texture_outputs.update(track_skid_overlay_outputs.values())
	if track_background_output:
		texture_outputs.add(track_background_output)
	return track_meta["xml"], entry, texture_outputs


def convert_car(source_root, output_dir, car_xml):
	car_meta = parse_car_metadata(source_root, car_xml)
	car_source_dir = source_root / car_xml.parent
	car_dir = output_dir / "cars" / car_meta["id"]
	car_texture_sources = {}
	for lod in car_meta["lods"]:
		lod_glb = car_dir / f"{Path(lod['model']).stem}.glb"
		result = convert_ac_to_glb(
			source_root,
			car_source_dir / lod["model"],
			lod_glb,
			classify_car_object,
		)
		car_texture_sources.update(result["textureSources"])
		lod["asset"] = relative_to_output(lod_glb, output_dir)
		lod["primitiveCount"] = result["primitives"]
		lod["objectNames"] = result["objects"]
		lod["materialClasses"] = sorted({material["class"] for material in result["materials"]})
		lod["materials"] = result["materials"]

	wheel_asset = None
	wheel_dir = car_meta["wheel3dDirectory"]
	wheel_basename = car_meta["wheel3dBasename"]
	if wheel_dir and wheel_basename:
		wheel_source_dir = source_root / "data/cars/wheels" / wheel_dir
		wheel_sources = [wheel_source_dir / f"{wheel_basename}{index}.acc" for index in range(4)]
		if all(path.exists() for path in wheel_sources):
			wheel_states = []
			for speed_index, wheel_source in enumerate(wheel_sources):
				wheel_glb = car_dir / f"{wheel_dir}-{wheel_basename}{speed_index}.glb"
				result = convert_ac_to_glb(
					source_root,
					wheel_source,
					wheel_glb,
					classify_wheel_object,
				)
				car_texture_sources.update(result["textureSources"])
				wheel_states.append({
					"speedIndex": speed_index,
					"source": runtime_path(wheel_source.relative_to(source_root)),
					"asset": relative_to_output(wheel_glb, output_dir),
					"primitiveCount": result["primitives"],
					"objectNames": result["objects"],
					"materialClasses": sorted({material["class"] for material in result["materials"]}),
					"materials": result["materials"],
				})
			wheel_asset = {
				"source": "torcs-detailed-wheel-acc",
				"directory": wheel_dir,
				"basename": wheel_basename,
				"speedThresholds": [20.0, 40.0, 70.0],
				"states": wheel_states,
			}

	for texture in [car_meta["wheelTexture"], car_meta["shadowTexture"]]:
		resolved = resolve_texture(source_root, car_source_dir, texture)
		if resolved:
			car_texture_sources[texture] = resolved

	car_texture_outputs = {
		name: relative_to_output(convert_texture(source, car_dir), output_dir)
		for name, source in sorted(car_texture_sources.items())
	}
	material_mask_output = ""
	material_mask_source = resolve_material_mask(source_root, car_meta["id"])
	if material_mask_source:
		material_mask_output = relative_to_output(convert_texture(material_mask_source, car_dir), output_dir)
	audio_dir = output_dir / "audio"
	car_audio_dir = audio_dir / "cars" / car_meta["id"]
	engine_sample_source = resolve_engine_sample(source_root, car_meta["id"], car_meta["sound"]["engineSample"])
	engine_sample_output = relative_to_output(copy_audio_sample(engine_sample_source, car_audio_dir), output_dir)
	entry = {
		"name": car_meta["name"],
		"wheelTexture": car_meta["wheelTexture"],
		"shadowTexture": car_meta["shadowTexture"],
		"wheelFallback": {
			"source": "runtime-snapshot",
			"texture": car_meta["wheelTexture"],
			"radiusScale": 1.0,
			"widthScale": 1.0,
		},
		"wheelAsset": wheel_asset,
		"wheelLayout": car_meta["wheelLayout"],
		"sound": {
			"engineSample": car_meta["sound"]["engineSample"],
			"engineAsset": engine_sample_output,
			"rpmScale": car_meta["sound"]["rpmScale"],
			"turbo": car_meta["sound"]["turbo"],
			"turboRpm": car_meta["sound"]["turboRpm"],
			"turboLag": car_meta["sound"]["turboLag"],
		},
		"lods": car_meta["lods"],
		"lights": car_meta["lights"],
		"materialMask": material_mask_output,
		"textures": {
			name: car_texture_outputs[name]
			for name in sorted(car_texture_outputs)
		},
	}
	texture_outputs = set(car_texture_outputs.values())
	if material_mask_output:
		texture_outputs.add(material_mask_output)
	return car_meta["xml"], entry, texture_outputs, {engine_sample_output}


def convert_effects(source_root, output_dir):
	effects_dir = output_dir / "effects"
	effect_texture_outputs = {}
	for name in EFFECT_TEXTURES:
		resolved = resolve_texture(source_root, source_root / "data/data/textures", name)
		if resolved:
			effect_texture_outputs[name] = relative_to_output(convert_texture(resolved, effects_dir), output_dir)
	audio_dir = output_dir / "audio"
	global_sound_outputs = {}
	for key, name in GLOBAL_SOUND_SAMPLES.items():
		source = source_root / "data/data/sound" / name
		global_sound_outputs[key] = {
			"sample": name,
			"asset": relative_to_output(copy_audio_sample(source, audio_dir / "sound"), output_dir),
		}
	crash_sound_outputs = []
	for name in CRASH_SOUND_SAMPLES:
		source = source_root / "data/data/sound" / name
		crash_sound_outputs.append({
			"sample": name,
			"asset": relative_to_output(copy_audio_sample(source, audio_dir / "sound"), output_dir),
		})
	sound_outputs = {entry["asset"] for entry in global_sound_outputs.values()}
	sound_outputs.update(entry["asset"] for entry in crash_sound_outputs)
	return {
		"textures": effect_texture_outputs,
		"sounds": global_sound_outputs,
		"crashes": crash_sound_outputs,
	}, set(effect_texture_outputs.values()), sound_outputs


def run_conversion(args):
	source_root = args.source_root.resolve()
	output_dir = args.output_dir.resolve()
	output_dir.mkdir(parents=True, exist_ok=True)
	clear_generated_output(output_dir)

	track_xmls, car_xmls = selected_asset_paths(source_root, args.quick)
	tracks = {}
	cars = {}
	texture_outputs = set()
	sound_outputs = set()
	for track_xml in track_xmls:
		key, entry, outputs = convert_track(source_root, output_dir, track_xml)
		tracks[key] = entry
		texture_outputs.update(outputs)
	for car_xml in car_xmls:
		key, entry, textures, sounds = convert_car(source_root, output_dir, car_xml)
		cars[key] = entry
		texture_outputs.update(textures)
		sound_outputs.update(sounds)
	effects, effect_textures, effect_sounds = convert_effects(source_root, output_dir)
	texture_outputs.update(effect_textures)
	sound_outputs.update(effect_sounds)
	manifest = {
		"version": 1,
		"generator": "tools/web-assets/convert_torcs_assets.py",
		"coordinateFrame": {
			"source": "AC3D x, height-y, z",
			"three": "x, height-y, z",
		},
		"tracks": tracks,
		"cars": cars,
		"effects": effects,
	}
	(output_dir / "manifest.json").write_text(json.dumps(manifest, indent="\t") + "\n", encoding="utf-8")
	print(json.dumps({
		"manifest": relative_to_output(output_dir / "manifest.json", output_dir),
		"tracks": len(tracks),
		"cars": len(cars),
		"textures": len(texture_outputs),
		"sounds": len(sound_outputs),
		"quick": args.quick,
	}))


def resolve_profile_output(args):
	if args.profile_output:
		return args.profile_output.resolve()
	return args.output_dir.resolve() / "convert-profile.html"


def main(argv=None):
	args = parse_args(argv)
	if not args.profile:
		run_conversion(args)
		return

	try:
		from pyinstrument import Profiler
	except ImportError as error:
		print(
			"Install pyinstrument to use --profile: python3 -m pip install pyinstrument",
			file=sys.stderr,
		)
		raise SystemExit(1) from error

	profiler = Profiler()
	profiler.start()
	try:
		run_conversion(args)
	finally:
		profiler.stop()

	profile_output = resolve_profile_output(args)
	profile_output.parent.mkdir(parents=True, exist_ok=True)
	profiler.write_html(profile_output)
	print(json.dumps({"profile": runtime_path(profile_output)}))


if __name__ == "__main__":
	main()
