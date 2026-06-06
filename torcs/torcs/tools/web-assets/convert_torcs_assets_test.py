#!/usr/bin/env python3
"""Tests for convert_torcs_assets.py."""

import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("convert_torcs_assets.py")
SPEC = importlib.util.spec_from_file_location("convert_torcs_assets", MODULE_PATH)
convert = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(convert)


def make_refs(count):
	return [(i, float(i), float(i)) for i in range(count)]


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
			track_path = source_root / convert.TRACK_XML
			track_path.parent.mkdir(parents=True)
			track_path.write_text(content, encoding="utf-8")

			metadata = convert.parse_track_metadata(source_root)

		self.assertEqual(metadata["specularColor"], [0.11, 0.12, 0.13])
		self.assertEqual(metadata["shininess"], 17.0)


if __name__ == "__main__":
	unittest.main()
