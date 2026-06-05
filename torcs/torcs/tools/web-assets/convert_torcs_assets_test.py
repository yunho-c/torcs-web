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


if __name__ == "__main__":
	unittest.main()
