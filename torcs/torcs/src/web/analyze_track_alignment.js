#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TRACKS = [
	"speed-dreams:data/tracks/circuit/jarama/jarama.xml",
	"speed-dreams-nordschleife:nordschleife.xml",
];
const DEFAULT_CAR = "/torcs/data/cars/models/kc-2000gt/kc-2000gt.xml";
const DEFAULT_CLASSES = new Set(["road"]);
const COMPONENT_SIZE = {
	5120: 1,
	5121: 1,
	5122: 2,
	5123: 2,
	5125: 4,
	5126: 4,
};
const TYPE_COMPONENTS = {
	SCALAR: 1,
	VEC2: 2,
	VEC3: 3,
	VEC4: 4,
};

function fail(message, details = undefined) {
	console.error(message);
	if (details) {
		console.error(JSON.stringify(details, null, "\t"));
	}
	process.exit(1);
}

function parseArgs(argv) {
	const args = {
		root: ".",
		tracks: [],
		classes: new Set(DEFAULT_CLASSES),
		coarseRadius: 16,
		coarseStep: 1,
		fineRadius: 2,
		fineStep: 0.25,
		grid: 1,
		maxRuntimePoints: 2500,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--track") {
			args.tracks.push(argv[++i]);
		} else if (arg === "--classes") {
			args.classes = new Set(String(argv[++i] || "").split(",").filter(Boolean));
		} else if (arg === "--include-curb") {
			args.classes.add("curb");
		} else if (arg === "--coarse-radius") {
			args.coarseRadius = Number(argv[++i]);
		} else if (arg === "--coarse-step") {
			args.coarseStep = Number(argv[++i]);
		} else if (arg === "--fine-radius") {
			args.fineRadius = Number(argv[++i]);
		} else if (arg === "--fine-step") {
			args.fineStep = Number(argv[++i]);
		} else if (arg === "--grid") {
			args.grid = Number(argv[++i]);
		} else if (arg === "--max-runtime-points") {
			args.maxRuntimePoints = Number(argv[++i]);
		} else if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		} else if (arg.startsWith("--")) {
			fail(`unknown option ${arg}`);
		} else {
			args.root = arg;
		}
	}
	if (!args.tracks.length) {
		args.tracks = DEFAULT_TRACKS;
	}
	return args;
}

function printHelp() {
	console.log(`Usage: node torcs/torcs/src/web/analyze_track_alignment.js <build-wasm-root> [options]

Compares converted track GLB road geometry against TORCS runtime road samples and
reports the best translation-only X/Z alignment.

Options:
  --track <manifest-key>       Track manifest key to analyze. May be repeated.
  --classes <a,b>              Visual material classes to treat as road. Default: road
  --include-curb               Include curb geometry in the visual road footprint.
  --coarse-radius <meters>     Coarse residual search radius around bounds alignment. Default: 16
  --coarse-step <meters>       Coarse search step. Default: 1
  --fine-radius <meters>       Fine search radius around the coarse winner. Default: 2
  --fine-step <meters>         Fine search step. Default: 0.25
  --grid <meters>              Visual occupancy grid size. Default: 1
`);
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readGlb(filePath) {
	const data = fs.readFileSync(filePath);
	if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2) {
		fail("invalid GLB", { file: filePath });
	}
	let offset = 12;
	let json = null;
	let bin = null;
	while (offset < data.length) {
		const length = data.readUInt32LE(offset);
		const kind = data.toString("ascii", offset + 4, offset + 8);
		offset += 8;
		const chunk = data.subarray(offset, offset + length);
		offset += length;
		if (kind === "JSON") {
			json = JSON.parse(chunk.toString("utf8"));
		} else if (kind === "BIN\0") {
			bin = chunk;
		}
	}
	if (!json || !bin) {
		fail("GLB is missing JSON or BIN chunk", { file: filePath });
	}
	return { json, bin };
}

function componentReader(buffer, componentType) {
	switch (componentType) {
		case 5120:
			return (offset) => buffer.readInt8(offset);
		case 5121:
			return (offset) => buffer.readUInt8(offset);
		case 5122:
			return (offset) => buffer.readInt16LE(offset);
		case 5123:
			return (offset) => buffer.readUInt16LE(offset);
		case 5125:
			return (offset) => buffer.readUInt32LE(offset);
		case 5126:
			return (offset) => buffer.readFloatLE(offset);
		default:
			fail("unsupported GLB accessor component type", { componentType });
			return null;
	}
}

function readAccessor(gltf, bin, accessorIndex) {
	const accessor = gltf.accessors[accessorIndex];
	const view = gltf.bufferViews[accessor.bufferView];
	const componentSize = COMPONENT_SIZE[accessor.componentType];
	const components = TYPE_COMPONENTS[accessor.type];
	if (!componentSize || !components) {
		fail("unsupported GLB accessor", { accessor });
	}
	const stride = view.byteStride || componentSize * components;
	const read = componentReader(bin, accessor.componentType);
	const baseOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
	const rows = [];
	for (let i = 0; i < accessor.count; i += 1) {
		const row = [];
		const rowOffset = baseOffset + i * stride;
		for (let component = 0; component < components; component += 1) {
			row.push(read(rowOffset + component * componentSize));
		}
		rows.push(row);
	}
	return rows;
}

function extendBounds(bounds, point) {
	bounds.minX = Math.min(bounds.minX, point.x);
	bounds.maxX = Math.max(bounds.maxX, point.x);
	bounds.minZ = Math.min(bounds.minZ, point.z);
	bounds.maxZ = Math.max(bounds.maxZ, point.z);
}

function emptyBounds() {
	return {
		minX: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		minZ: Number.POSITIVE_INFINITY,
		maxZ: Number.NEGATIVE_INFINITY,
	};
}

function boundsCenter(bounds) {
	return {
		x: (bounds.minX + bounds.maxX) * 0.5,
		z: (bounds.minZ + bounds.maxZ) * 0.5,
	};
}

function edgeKey(a, b) {
	const ka = `${Math.round(a.x * 100)},${Math.round(a.z * 100)}`;
	const kb = `${Math.round(b.x * 100)},${Math.round(b.z * 100)}`;
	return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function extractVisualRoad(glbPath, classes) {
	const { json: gltf, bin } = readGlb(glbPath);
	const allBounds = emptyBounds();
	const roadBounds = emptyBounds();
	const triangles = [];
	const edgeRecords = new Map();
	const materialCounts = {};
	for (const mesh of gltf.meshes || []) {
		for (const primitive of mesh.primitives || []) {
			const material = gltf.materials && gltf.materials[primitive.material];
			const extras = (material && material.extras) || {};
			const materialClass = extras.torcsMaterialClass || "unclassified";
			const overlayRole = extras.torcsOverlayRole || "";
			materialCounts[materialClass] = (materialCounts[materialClass] || 0) + 1;
			const positions = readAccessor(gltf, bin, primitive.attributes.POSITION)
				.map((row) => ({ x: row[0], z: row[2] }));
			for (const point of positions) {
				extendBounds(allBounds, point);
			}
			if (!classes.has(materialClass) || overlayRole) {
				continue;
			}
			const indices = primitive.indices !== undefined
				? readAccessor(gltf, bin, primitive.indices).map((row) => row[0])
				: positions.map((_, index) => index);
			for (let i = 0; i + 2 < indices.length; i += 3) {
				const tri = [positions[indices[i]], positions[indices[i + 1]], positions[indices[i + 2]]];
				if (triangleArea2D(tri) <= 0.0001) {
					continue;
				}
				triangles.push(tri);
				for (const point of tri) {
					extendBounds(roadBounds, point);
				}
				for (const [a, b] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
					const key = edgeKey(a, b);
					const record = edgeRecords.get(key) || { a, b, count: 0 };
					record.count += 1;
					edgeRecords.set(key, record);
				}
			}
		}
	}
	const boundaryEdges = Array.from(edgeRecords.values()).filter((edge) => edge.count === 1);
	const boundaryPoints = sampleEdges(boundaryEdges, 0.5);
	if (!triangles.length) {
		fail("no visual road triangles found in GLB", { glbPath, classes: Array.from(classes), materialCounts });
	}
	return { allBounds, roadBounds, triangles, boundaryPoints, materialCounts };
}

function triangleArea2D(tri) {
	return Math.abs(
		(tri[1].x - tri[0].x) * (tri[2].z - tri[0].z) -
		(tri[2].x - tri[0].x) * (tri[1].z - tri[0].z)
	) * 0.5;
}

function sampleEdges(edges, spacing) {
	const points = [];
	for (const edge of edges) {
		const length = Math.hypot(edge.b.x - edge.a.x, edge.b.z - edge.a.z);
		const count = Math.max(1, Math.ceil(length / spacing));
		for (let i = 0; i <= count; i += 1) {
			const t = i / count;
			points.push({
				x: edge.a.x + (edge.b.x - edge.a.x) * t,
				z: edge.a.z + (edge.b.z - edge.a.z) * t,
			});
		}
	}
	return points;
}

function pointInTriangle(point, tri) {
	const v0x = tri[2].x - tri[0].x;
	const v0z = tri[2].z - tri[0].z;
	const v1x = tri[1].x - tri[0].x;
	const v1z = tri[1].z - tri[0].z;
	const v2x = point.x - tri[0].x;
	const v2z = point.z - tri[0].z;
	const dot00 = v0x * v0x + v0z * v0z;
	const dot01 = v0x * v1x + v0z * v1z;
	const dot02 = v0x * v2x + v0z * v2z;
	const dot11 = v1x * v1x + v1z * v1z;
	const dot12 = v1x * v2x + v1z * v2z;
	const denom = dot00 * dot11 - dot01 * dot01;
	if (Math.abs(denom) < 1e-9) {
		return false;
	}
	const invDenom = 1 / denom;
	const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
	const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
	return u >= 0 && v >= 0 && u + v <= 1;
}

function gridKey(point, grid) {
	return `${Math.floor(point.x / grid)},${Math.floor(point.z / grid)}`;
}

function rasterizeTriangles(triangles, grid) {
	const cells = new Set();
	for (const tri of triangles) {
		const minX = Math.floor(Math.min(tri[0].x, tri[1].x, tri[2].x) / grid);
		const maxX = Math.floor(Math.max(tri[0].x, tri[1].x, tri[2].x) / grid);
		const minZ = Math.floor(Math.min(tri[0].z, tri[1].z, tri[2].z) / grid);
		const maxZ = Math.floor(Math.max(tri[0].z, tri[1].z, tri[2].z) / grid);
		for (let ix = minX; ix <= maxX; ix += 1) {
			for (let iz = minZ; iz <= maxZ; iz += 1) {
				const point = { x: (ix + 0.5) * grid, z: (iz + 0.5) * grid };
				if (pointInTriangle(point, tri)) {
					cells.add(`${ix},${iz}`);
				}
			}
		}
	}
	return cells;
}

function makePointGrid(points, grid) {
	const buckets = new Map();
	for (const point of points) {
		const key = gridKey(point, grid);
		if (!buckets.has(key)) {
			buckets.set(key, []);
		}
		buckets.get(key).push(point);
	}
	return buckets;
}

function nearestDistance(point, pointGrid, grid, maxRadiusCells = 8) {
	const baseX = Math.floor(point.x / grid);
	const baseZ = Math.floor(point.z / grid);
	let best = Number.POSITIVE_INFINITY;
	for (let radius = 0; radius <= maxRadiusCells; radius += 1) {
		for (let ix = baseX - radius; ix <= baseX + radius; ix += 1) {
			for (let iz = baseZ - radius; iz <= baseZ + radius; iz += 1) {
				if (radius > 0 && ix > baseX - radius && ix < baseX + radius && iz > baseZ - radius && iz < baseZ + radius) {
					continue;
				}
				const candidates = pointGrid.get(`${ix},${iz}`);
				if (!candidates) {
					continue;
				}
				for (const candidate of candidates) {
					best = Math.min(best, Math.hypot(point.x - candidate.x, point.z - candidate.z));
				}
			}
		}
		if (Number.isFinite(best)) {
			return best;
		}
	}
	return grid * maxRadiusCells;
}

function torcsToThreeSample(x, y) {
	return { x, z: -y };
}

function readRuntimeTrack(module, runtimePath) {
	const start = module.ccall(
		"torcs_web_runtime_start_with_files",
		"number",
		["string", "string"],
		[runtimePath, DEFAULT_CAR],
	);
	if (start !== 0) {
		fail("could not start TORCS runtime", { runtimePath, start });
	}
	try {
		const count = module.ccall("torcs_web_runtime_get_track_sample_count", "number", [], []);
		const left = [];
		const right = [];
		const center = [];
		const bounds = emptyBounds();
		for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
			const samples = {};
			for (const [name, side] of [["right", 0], ["center", 1], ["left", 2]]) {
				const x = module.ccall("torcs_web_runtime_get_track_sample_x", "number", ["number", "number"], [sampleIndex, side]);
				const y = module.ccall("torcs_web_runtime_get_track_sample_y", "number", ["number", "number"], [sampleIndex, side]);
				samples[name] = torcsToThreeSample(x, y);
			}
			right.push(samples.right);
			center.push(samples.center);
			left.push(samples.left);
			extendBounds(bounds, samples.right);
			extendBounds(bounds, samples.left);
		}
		return { count, left, right, center, bounds };
	} finally {
		module.ccall("torcs_web_runtime_shutdown", null, [], []);
	}
}

function sampleRuntimeStrip(track, maxPoints) {
	const strip = [];
	const edges = [];
	const step = Math.max(1, Math.ceil(track.count / Math.max(1, Math.floor(maxPoints / 11))));
	for (let i = 0; i < track.count; i += step) {
		const left = track.left[i];
		const right = track.right[i];
		if (!left || !right) {
			continue;
		}
		edges.push(left, right);
		for (let j = 0; j <= 10; j += 1) {
			const t = j / 10;
			strip.push({
				x: right.x + (left.x - right.x) * t,
				z: right.z + (left.z - right.z) * t,
			});
		}
	}
	return { strip, edges };
}

function evaluateOffset(totalOffset, runtimePoints, visualCells, visualBoundaryGrid, grid) {
	let occupied = 0;
	for (const point of runtimePoints.strip) {
		if (visualCells.has(gridKey({ x: point.x - totalOffset.x, z: point.z - totalOffset.z }, grid))) {
			occupied += 1;
		}
	}
	let edgeDistance = 0;
	for (const point of runtimePoints.edges) {
		edgeDistance += nearestDistance(
			{ x: point.x - totalOffset.x, z: point.z - totalOffset.z },
			visualBoundaryGrid,
			grid,
		);
	}
	return {
		occupancyRatio: runtimePoints.strip.length ? occupied / runtimePoints.strip.length : 0,
		edgeMeanDistance: runtimePoints.edges.length ? edgeDistance / runtimePoints.edges.length : Number.POSITIVE_INFINITY,
	};
}

function rangeAround(center, radius, step) {
	const values = [];
	const start = center - radius;
	const end = center + radius + step * 0.5;
	for (let value = start; value <= end; value += step) {
		values.push(Number(value.toFixed(6)));
	}
	return values;
}

function searchOffsets(baseOffset, runtimePoints, visualCells, visualBoundaryGrid, grid, options) {
	const search = (center, radius, step) => {
		let best = null;
		for (const residualX of rangeAround(center.x, radius, step)) {
			for (const residualZ of rangeAround(center.z, radius, step)) {
				const totalOffset = {
					x: baseOffset.x + residualX,
					z: baseOffset.z + residualZ,
				};
				const score = evaluateOffset(totalOffset, runtimePoints, visualCells, visualBoundaryGrid, grid);
				const candidate = { residualX, residualZ, totalOffsetX: totalOffset.x, totalOffsetZ: totalOffset.z, ...score };
				if (!best ||
					candidate.edgeMeanDistance < best.edgeMeanDistance - 1e-9 ||
					(Math.abs(candidate.edgeMeanDistance - best.edgeMeanDistance) <= 1e-9 &&
						candidate.occupancyRatio > best.occupancyRatio)) {
					best = candidate;
				}
			}
		}
		return best;
	};
	const coarse = search({ x: 0, z: 0 }, options.coarseRadius, options.coarseStep);
	const fine = search({ x: coarse.residualX, z: coarse.residualZ }, options.fineRadius, options.fineStep);
	return { coarse, fine };
}

async function createRuntimeModule(root) {
	const createModule = require(path.join(root, "torcs_web_probe.js"));
	return createModule({ locateFile: (file) => path.join(root, file) });
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const root = path.resolve(args.root);
	const manifestPath = path.join(root, "web-assets", "manifest.json");
	if (!fs.existsSync(manifestPath)) {
		fail("could not find built web asset manifest", { manifestPath });
	}
	const manifest = readJson(manifestPath);
	const module = await createRuntimeModule(root);
	const results = [];
	for (const trackKey of args.tracks) {
		const entry = manifest.tracks && manifest.tracks[trackKey];
		if (!entry) {
			fail("track key not found in manifest", { trackKey });
		}
		if (!entry.runtimeSupported || !entry.runtimePath) {
			fail("track does not have runtime support", { trackKey, entry });
		}
		const glbPath = path.join(root, "web-assets", entry.asset);
		const visual = extractVisualRoad(glbPath, args.classes);
		const runtime = readRuntimeTrack(module, entry.runtimePath);
		const visualCenter = boundsCenter(visual.allBounds);
		const visualRoadCenter = boundsCenter(visual.roadBounds);
		const runtimeCenter = boundsCenter(runtime.bounds);
		const coarseBoundsOffset = {
			x: runtimeCenter.x - visualCenter.x,
			z: runtimeCenter.z - visualCenter.z,
		};
		const roadBoundsOffset = {
			x: runtimeCenter.x - visualRoadCenter.x,
			z: runtimeCenter.z - visualRoadCenter.z,
		};
		const visualCells = rasterizeTriangles(visual.triangles, args.grid);
		const visualBoundaryGrid = makePointGrid(visual.boundaryPoints, args.grid);
		const runtimePoints = sampleRuntimeStrip(runtime, args.maxRuntimePoints);
		const search = searchOffsets(
			coarseBoundsOffset,
			runtimePoints,
			visualCells,
			visualBoundaryGrid,
			args.grid,
			args,
		);
		results.push({
			track: trackKey,
			name: entry.name,
			asset: entry.asset,
			runtimePath: entry.runtimePath,
			classes: Array.from(args.classes),
			materialCounts: visual.materialCounts,
			counts: {
				runtimeSamples: runtime.count,
				runtimeStripPoints: runtimePoints.strip.length,
				runtimeEdgePoints: runtimePoints.edges.length,
				visualRoadTriangles: visual.triangles.length,
				visualBoundaryPoints: visual.boundaryPoints.length,
				visualOccupancyCells: visualCells.size,
			},
			bounds: {
				visualAll: visual.allBounds,
				visualRoad: visual.roadBounds,
				runtime: runtime.bounds,
			},
			coarseBoundsOffset,
			roadBoundsOffset,
			searchBase: "coarseBoundsOffset",
			search,
		});
	}
	console.log(JSON.stringify({ root, options: { ...args, classes: Array.from(args.classes) }, results }, null, "\t"));
}

main().catch((error) => {
	fail("track alignment analysis failed", {
		message: error && error.message ? error.message : String(error),
		stack: error && error.stack ? error.stack : undefined,
	});
});
