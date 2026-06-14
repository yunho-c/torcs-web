#!/usr/bin/env python3
"""Tests for convert_torcs_assets.py."""

import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("convert_torcs_assets.py")
SOURCE_ROOT = MODULE_PATH.parents[2]
SPEC = importlib.util.spec_from_file_location("convert_torcs_assets", MODULE_PATH)
convert = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(convert)


def make_refs(count):
	return [(i, float(i), float(i)) for i in range(count)]


def read_glb_json(path):
	data = path.read_bytes()
	offset = 12
	while offset < len(data):
		length, kind = struct.unpack("<I4s", data[offset:offset + 8])
		offset += 8
		if kind == b"JSON":
			return json.loads(data[offset:offset + length].decode("utf-8"))
		offset += length
	raise AssertionError("GLB JSON chunk not found")


class ConvertTorcsAssetsTest(unittest.TestCase):
	def test_triangulates_fan_surfaces(self):
		refs = make_refs(4)

		self.assertEqual(
			convert.triangulate_surface(refs, 0x00),
			[
				[refs[0], refs[1], refs[2]],
				[refs[0], refs[2], refs[3]],
			],
		)

	def test_triangulates_strip_surfaces_with_alternating_winding(self):
		refs = make_refs(5)

		self.assertEqual(
			convert.triangulate_surface(refs, 0x14),
			[
				[refs[0], refs[1], refs[2]],
				[refs[2], refs[1], refs[3]],
				[refs[2], refs[3], refs[4]],
			],
		)

	def test_skips_line_surfaces(self):
		refs = make_refs(4)

		self.assertEqual(convert.triangulate_surface(refs, 0x11), [])
		self.assertEqual(convert.triangulate_surface(refs, 0x12), [])

	def test_parse_ac3d_preserves_surface_flags(self):
		content = """AC3Db
OBJECT poly
name "strip"
numvert 3
0 0 0
1 0 0
1 1 0
numsurf 1
SURF 0x14
mat 0
refs 3
0 0 0
1 1 0
2 1 1
kids 0
"""
		with tempfile.TemporaryDirectory() as tmp_dir:
			path = Path(tmp_dir) / "strip.acc"
			path.write_text(content, encoding="latin-1")

			objects = convert.parse_ac3d(path)

		self.assertEqual(len(objects), 1)
		self.assertEqual(objects[0].surfaces[0]["flags"], 0x14)
		self.assertEqual(convert.surface_primitive_type(objects[0].surfaces[0]["flags"]), 4)

	def test_tree_textures_use_masked_alpha(self):
		material = {}

		convert.apply_texture_alpha(material, "treeg1.rgb")

		self.assertEqual(material["alphaMode"], "MASK")
		self.assertEqual(material["alphaCutoff"], convert.TREE_ALPHA_CUTOFF)

	def test_non_billboard_texture_does_not_set_alpha_mode(self):
		material = {}

		convert.apply_texture_alpha(material, "kc-2000gt.rgb")

		self.assertNotIn("alphaMode", material)

	def test_add_accessor_supports_32_bit_indices(self):
		gltf = {"accessors": []}
		buffer_views = []
		buffer_parts = []

		accessor = convert.add_accessor(gltf, buffer_views, buffer_parts, 5125, "SCALAR", [0, 70000])

		self.assertEqual(accessor, 0)
		self.assertEqual(gltf["accessors"][0]["componentType"], 5125)

	def test_classifies_car_object_names(self):
		self.assertEqual(convert.classify_car_object("WIFRONTWIND_s_0"), "glass")
		self.assertEqual(convert.classify_car_object("WI_s_5"), "glass")
		self.assertEqual(convert.classify_car_object("WI2_s_1"), "glass")
		self.assertEqual(convert.classify_car_object("WI3_s_4"), "glass")
		self.assertEqual(convert.classify_car_object("WIFRONT_s_0"), "glass")
		self.assertEqual(convert.classify_car_object("WIREAR_s_0"), "glass")
		self.assertEqual(convert.classify_car_object("WISIDE_s_3"), "glass")
		self.assertEqual(convert.classify_car_object("MIRRORGLASS_s_1"), "mirrorGlass")
		self.assertEqual(convert.classify_car_object("MIRRORGLAS_s_1"), "mirrorGlass")
		self.assertEqual(convert.classify_car_object("FRONTLIGHTB_s_1"), "headlamp")
		self.assertEqual(convert.classify_car_object("FRONLIGHTMO_s_1"), "headlamp")
		self.assertEqual(convert.classify_car_object("MAINLIGHTFR_s_1"), "headlamp")
		self.assertEqual(convert.classify_car_object("WIMAINLIGHT_s_1"), "headlamp")
		self.assertEqual(convert.classify_car_object("REARLIGHTFR_s_1"), "taillamp")
		self.assertEqual(convert.classify_car_object("WILIGHTREAR2_s_1"), "taillamp")
		self.assertEqual(convert.classify_car_object("LIGHTREAR_s_7"), "taillamp")
		self.assertEqual(convert.classify_car_object("EXHAUSTPIPE_s_3"), "exhaust")
		self.assertEqual(convert.classify_car_object("OUTEREXHAUS_s_1"), "exhaust")
		self.assertEqual(convert.classify_car_object("INNEREXHAUS_s_1"), "exhaust")
		self.assertEqual(convert.classify_car_object("WIPER_s_5"), "blackTrim")
		self.assertEqual(convert.classify_car_object("FRONTWINGSTABOUTSIDE_s_1", "carbon-128.rgb"), "blackTrim")
		self.assertEqual(convert.classify_car_object("COCKPITREAR_s_0"), "interior")
		self.assertEqual(convert.classify_car_object("DASHBOARD_s_1"), "interior")
		self.assertEqual(convert.classify_car_object("STEERW_s_2"), "interior")
		self.assertEqual(convert.classify_car_object("DRIVERPART1_s_5"), "driver")
		self.assertEqual(convert.classify_car_object("BODY_s_1", "driver.rgb"), "driver")
		self.assertEqual(convert.classify_car_object("BRAKECOOLIN_s_1"), "body")
		self.assertEqual(convert.classify_car_object("ROOF_s_4"), "body")

	def test_classifies_track_object_names_and_textures(self):
		self.assertEqual(convert.classify_track_object("TKMN708", "tr-road1.rgb"), "road")
		self.assertEqual(convert.classify_track_object("TKRS703", "tr-grass6.rgb"), "grass")
		self.assertEqual(convert.classify_track_object("TKLS6053", "sand-new.png"), "sand")
		self.assertEqual(convert.classify_track_object("B0RT4781", "armco.png"), "barrier")
		self.assertEqual(convert.classify_track_object("B2LT261", "tirewall.png"), "tireWall")
		self.assertEqual(convert.classify_track_object("OBJ300", "treeg1.rgb"), "treeFoliage")
		self.assertEqual(convert.classify_track_object("O17S0", "CONCTP.png"), "concrete")
		self.assertEqual(convert.classify_track_object("STAIRSFENCES2", "TRIBB03.png"), "building")
		self.assertEqual(convert.classify_track_object("FENCES0", "fence.png"), "fence")
		self.assertEqual(convert.classify_track_object("OBJECT680", "SEMA02.png"), "sign")
		self.assertEqual(convert.classify_track_object("TERR8", ""), "terrain")
		self.assertEqual(convert.classify_track_object("OBJ1", "unknown.png"), "")

	def test_car_material_classes_split_primitives_and_glb_metadata(self):
		content = """AC3Db
OBJECT world
kids 2
OBJECT poly
name "WIFRONTWIND_s_0"
texture "car.rgb" base
numvert 3
0 0 0
1 0 0
0 1 0
numsurf 1
SURF 0x14
mat 0
refs 3
0 0 0
1 1 0
2 0 1
kids 0
OBJECT poly
name "EXHAUSTPIPE_s_3"
texture "car.rgb" base
numvert 3
0 0 1
1 0 1
0 1 1
numsurf 1
SURF 0x14
mat 0
refs 3
0 0 0
1 1 0
2 0 1
kids 0
"""
		with tempfile.TemporaryDirectory() as tmp_dir:
			source_root = Path(tmp_dir)
			car_dir = source_root / "data/cars/models/demo-car"
			car_dir.mkdir(parents=True)
			(car_dir / "car.rgb").write_bytes(b"placeholder")
			source_path = car_dir / "demo-car.acc"
			source_path.write_text(content, encoding="latin-1")
			output_path = source_root / "out.glb"

			result = convert.convert_ac_to_glb(source_root, source_path, output_path, convert.classify_car_object)
			gltf = read_glb_json(output_path)

		self.assertEqual(result["primitives"], 2)
		self.assertEqual({material["class"] for material in result["materials"]}, {"glass", "exhaust"})
		extras_by_class = {
			material["extras"]["torcsMaterialClass"]: material["extras"]
			for material in gltf["materials"]
		}
		self.assertEqual(extras_by_class["glass"]["torcsSourceTexture"], "car.rgb")
		self.assertEqual(extras_by_class["glass"]["torcsObjectNames"], ["WIFRONTWIND_s_0"])
		self.assertEqual(extras_by_class["exhaust"]["torcsObjectNames"], ["EXHAUSTPIPE_s_3"])

	def test_car7_trb1_preserves_reference_material_classes(self):
		source_path = SOURCE_ROOT / "data/cars/models/car7-trb1/car7-trb1.acc"
		with tempfile.TemporaryDirectory() as tmp_dir:
			output_path = Path(tmp_dir) / "car7-trb1.glb"

			result = convert.convert_ac_to_glb(SOURCE_ROOT, source_path, output_path, convert.classify_car_object)

		classes = {material["class"] for material in result["materials"]}
		self.assertGreater(result["primitives"], 2)
		self.assertTrue({"body", "glass", "headlamp", "taillamp", "exhaust"}.issubset(classes))

	def test_kc_2000gt_windows_are_classified_as_glass(self):
		source_path = SOURCE_ROOT / "data/cars/models/kc-2000gt/kc-2000gt.acc"
		with tempfile.TemporaryDirectory() as tmp_dir:
			output_path = Path(tmp_dir) / "kc-2000gt.glb"

			result = convert.convert_ac_to_glb(SOURCE_ROOT, source_path, output_path, convert.classify_car_object)

		glass_materials = [material for material in result["materials"] if material["class"] == "glass"]
		glass_objects = {name for material in glass_materials for name in material["objectNames"]}
		self.assertTrue(glass_materials)
		self.assertIn("WI_s_5", glass_objects)

	def test_convert_car_copies_optional_material_mask(self):
		car_xml = Path("data/cars/models/demo-car/demo-car.xml")
		content = """<?xml version="1.0"?>
<params name="demo-car">
<section name="Graphic Objects">
<attstr name="wheel texture" val="wheel.png"/>
<attstr name="shadow texture" val="shadow.png"/>
<section name="Ranges">
<section name="1">
<attnum name="threshold" val="0"/>
<attstr name="car" val="demo-car.acc"/>
<attstr name="wheels" val="yes"/>
</section>
</section>
</section>
<section name="Sound">
<attstr name="engine sample" val="engine.wav"/>
</section>
</params>
"""
		asset = """AC3Db
OBJECT poly
name "ROOF_s_4"
texture "body.png" base
numvert 3
0 0 0
1 0 0
0 1 0
numsurf 1
SURF 0x14
mat 0
refs 3
0 0 0
1 1 0
2 0 1
kids 0
"""
		with tempfile.TemporaryDirectory() as tmp_dir:
			source_root = Path(tmp_dir) / "source"
			output_dir = Path(tmp_dir) / "out"
			car_dir = source_root / car_xml.parent
			car_dir.mkdir(parents=True)
			(car_dir / car_xml.name).write_text(content, encoding="utf-8")
			(car_dir / "demo-car.acc").write_text(asset, encoding="latin-1")
			for name in ["body.png", "wheel.png", "shadow.png", "demo-car-material-mask.png"]:
				convert.write_png(car_dir / name, 1, 1, b"\xff\0\0\xff")
			(car_dir / "engine.wav").write_bytes(b"RIFFxxxxWAVE" + b"\0" * 32)

			_, entry, textures, _ = convert.convert_car(source_root, output_dir, car_xml)

			self.assertEqual(entry["materialMask"], "cars/demo-car/demo-car-material-mask.png")
			self.assertIn("cars/demo-car/demo-car-material-mask.png", textures)
			self.assertTrue((output_dir / entry["materialMask"]).exists())

	def test_parse_track_metadata_includes_material_controls(self):
		content = """<?xml version="1.0"?>
<params name="Test Track">
<section name="Header">
<attstr name="name" val="Test Track"/>
<attstr name="category" val="road"/>
</section>
<section name="Graphic">
<attstr name="3d description" val="test.acc"/>
<attstr name="background image" val="background.png"/>
<attnum name="specular color R" val="0.11"/>
<attnum name="specular color G" val="0.12"/>
<attnum name="specular color B" val="0.13"/>
<attnum name="shininess" val="17"/>
</section>
</params>
"""
		with tempfile.TemporaryDirectory() as tmp_dir:
			source_root = Path(tmp_dir)
			track_path = source_root / convert.GOLDEN_TRACK_XML
			track_path.parent.mkdir(parents=True)
			track_path.write_text(content, encoding="utf-8")

			metadata = convert.parse_track_metadata(source_root, convert.GOLDEN_TRACK_XML)

		self.assertEqual(metadata["specularColor"], [0.11, 0.12, 0.13])
		self.assertEqual(metadata["shininess"], 17.0)

	def test_convert_track_adds_material_metadata(self):
		track_xml = Path("data/tracks/road/demo/demo.xml")
		content = """<?xml version="1.0"?>
<params name="Demo Track">
<section name="Header">
<attstr name="name" val="Demo Track"/>
<attstr name="category" val="road"/>
</section>
<section name="Graphic">
<attstr name="3d description" val="demo.acc"/>
<attstr name="background image" val="background.png"/>
</section>
</params>
"""
		asset = """AC3Db
OBJECT world
kids 3
OBJECT poly
name "TKMN0"
texture "tr-road1.png" base
numvert 3
0 0 0
1 0 0
0 1 0
numsurf 1
SURF 0x14
mat 0
refs 3
0 0 0
1 1 0
2 0 1
kids 0
OBJECT poly
name "B0RT0"
texture "armco.png" base
numvert 3
0 0 1
1 0 1
0 1 1
numsurf 1
SURF 0x14
mat 0
refs 3
0 0 0
1 1 0
2 0 1
kids 0
OBJECT poly
name "OBJ1"
texture "treeg1.png" base
numvert 3
0 0 2
1 0 2
0 1 2
numsurf 1
SURF 0x14
mat 0
refs 3
0 0 0
1 1 0
2 0 1
kids 0
"""
		with tempfile.TemporaryDirectory() as tmp_dir:
			source_root = Path(tmp_dir) / "source"
			output_dir = Path(tmp_dir) / "out"
			track_dir = source_root / track_xml.parent
			track_dir.mkdir(parents=True)
			(track_dir / track_xml.name).write_text(content, encoding="utf-8")
			(track_dir / "demo.acc").write_text(asset, encoding="latin-1")
			for name in ["tr-road1.png", "armco.png", "treeg1.png", "background.png"]:
				convert.write_png(track_dir / name, 1, 1, b"\xff\0\0\xff")

			_, entry, textures = convert.convert_track(source_root, output_dir, track_xml)

		self.assertEqual(entry["materialClasses"], ["barrier", "road", "treeFoliage"])
		self.assertEqual({material["class"] for material in entry["materials"]}, {"barrier", "road", "treeFoliage"})
		self.assertIn("tracks/road/demo/tr-road1.png", textures)

	def test_quick_mode_selects_golden_asset_pair(self):
		with tempfile.TemporaryDirectory() as tmp_dir:
			source_root = Path(tmp_dir)

			tracks, cars = convert.selected_asset_paths(source_root, quick=True)

		self.assertEqual(tracks, [convert.GOLDEN_TRACK_XML])
		self.assertEqual(cars, [convert.GOLDEN_CAR_XML])

	def test_discovery_ignores_project_and_texmapper_xmls(self):
		with tempfile.TemporaryDirectory() as tmp_dir:
			source_root = Path(tmp_dir)
			track_root = source_root / "data/tracks/road/demo"
			track_root.mkdir(parents=True)
			(track_root / "demo.xml").write_text("<params/>", encoding="utf-8")
			(track_root / "demo.prj.xml").write_text("<params/>", encoding="utf-8")
			(track_root / "demo.prj-src.xml").write_text("<params/>", encoding="utf-8")
			car_root = source_root / "data/cars/models/demo-car"
			car_root.mkdir(parents=True)
			(car_root / "demo-car.xml").write_text("<params/>", encoding="utf-8")
			(car_root / "texmapper.xml").write_text("<params/>", encoding="utf-8")

			tracks = convert.discover_track_xmls(source_root)
			cars = convert.discover_car_xmls(source_root)

		self.assertEqual(tracks, [Path("data/tracks/road/demo/demo.xml")])
		self.assertEqual(cars, [Path("data/cars/models/demo-car/demo-car.xml")])


if __name__ == "__main__":
	unittest.main()
