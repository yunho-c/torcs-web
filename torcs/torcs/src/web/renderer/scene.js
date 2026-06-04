import * as THREE from "three";
import { SNAPSHOT } from "./runtime.js";

const ROAD_Y = 0.03;

function torcsToThree(x, y, z = 0) {
	return new THREE.Vector3(x, z, -y);
}

function makeLine(points, color, opacity, yOffset = ROAD_Y) {
	const geometry = new THREE.BufferGeometry().setFromPoints(
		points.map((point) => torcsToThree(point.x, point.y, yOffset)),
	);
	const material = new THREE.LineBasicMaterial({
		color,
		transparent: opacity < 1,
		opacity,
	});
	return new THREE.LineLoop(geometry, material);
}

function makeRoadMesh(track) {
	const positions = [];
	const indices = [];
	for (let i = 0; i < track.left.length; i += 1) {
		const left = torcsToThree(track.left[i].x, track.left[i].y, 0);
		const right = torcsToThree(track.right[i].x, track.right[i].y, 0);
		positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
	}
	for (let i = 0; i < track.left.length; i += 1) {
		const next = (i + 1) % track.left.length;
		const left = i * 2;
		const right = left + 1;
		const nextLeft = next * 2;
		const nextRight = nextLeft + 1;
		indices.push(left, right, nextLeft, right, nextRight, nextLeft);
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return new THREE.Mesh(
		geometry,
		new THREE.MeshLambertMaterial({ color: 0x30342e, side: THREE.DoubleSide }),
	);
}

export class TorcsScene {
	constructor(canvas) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.setClearColor(0x0b0d0c, 1);

		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(0x0b0d0c);
		this.scene.fog = new THREE.Fog(0x0b0d0c, 140, 820);

		this.groups = {
			background: new THREE.Group(),
			land: new THREE.Group(),
			cars: new THREE.Group(),
			shadows: new THREE.Group(),
		};
		for (const group of Object.values(this.groups)) {
			this.scene.add(group);
		}

		this.addLighting();
		this.addReferenceGrid();
		this.car = null;
		this.carShadow = null;
		this.footprint = null;
		this.track = null;
	}

	addLighting() {
		const hemi = new THREE.HemisphereLight(0xd8e0db, 0x272b23, 1.7);
		this.scene.add(hemi);
		const sun = new THREE.DirectionalLight(0xfff0d2, 2.2);
		sun.position.set(-90, 160, 80);
		this.scene.add(sun);
	}

	addReferenceGrid() {
		const grid = new THREE.GridHelper(720, 48, 0x435047, 0x242a25);
		grid.position.y = -0.01;
		this.groups.land.add(grid);
	}

	setTrack(track) {
		if (this.track) {
			this.groups.land.remove(this.track);
		}
		const root = new THREE.Group();
		root.add(makeRoadMesh(track));
		root.add(makeLine(track.left, 0xe8e2d0, 0.82));
		root.add(makeLine(track.right, 0xe8e2d0, 0.82));
		root.add(makeLine(track.center, 0x7fc3c9, 0.48, ROAD_Y + 0.03));
		this.track = root;
		this.groups.land.add(root);
	}

	createCar(values) {
		const geometry = new THREE.BoxGeometry(
			Math.max(0.1, values[SNAPSHOT.dimensionX]),
			Math.max(0.1, values[SNAPSHOT.dimensionZ]),
			Math.max(0.1, values[SNAPSHOT.dimensionY]),
		);
		const material = new THREE.MeshLambertMaterial({ color: 0xc9483d });
		this.car = new THREE.Mesh(geometry, material);
		this.groups.cars.add(this.car);

		this.carShadow = new THREE.Mesh(
			new THREE.CircleGeometry(1, 32),
			new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false }),
		);
		this.carShadow.rotation.x = -Math.PI / 2;
		this.groups.shadows.add(this.carShadow);

		this.footprint = makeLine([], 0xf3ead6, 0.92, ROAD_Y + 0.08);
		this.groups.cars.add(this.footprint);
	}

	updateCar(values) {
		if (!this.car) {
			this.createCar(values);
		}

		this.car.position.copy(torcsToThree(values[SNAPSHOT.x], values[SNAPSHOT.y], values[SNAPSHOT.z]));
		this.car.rotation.set(values[SNAPSHOT.pitch], values[SNAPSHOT.yaw], -values[SNAPSHOT.roll], "YXZ");

		this.carShadow.position.set(this.car.position.x, ROAD_Y + 0.01, this.car.position.z);
		this.carShadow.scale.set(
			Math.max(1, values[SNAPSHOT.dimensionX] * 0.6),
			Math.max(1, values[SNAPSHOT.dimensionY] * 0.8),
			1,
		);

		const footprintPoints = [];
		const order = [0, 1, 3, 2];
		for (const index of order) {
			footprintPoints.push(torcsToThree(
				values[SNAPSHOT.cornerX0 + index],
				values[SNAPSHOT.cornerY0 + index],
				ROAD_Y + 0.08,
			));
		}
		this.footprint.geometry.dispose();
		this.footprint.geometry = new THREE.BufferGeometry().setFromPoints(footprintPoints);
	}

	resize() {
		const canvas = this.renderer.domElement;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		if (canvas.width !== Math.floor(width * this.renderer.getPixelRatio()) ||
			canvas.height !== Math.floor(height * this.renderer.getPixelRatio())) {
			this.renderer.setSize(width, height, false);
			return true;
		}
		return false;
	}

	render(camera) {
		this.renderer.render(this.scene, camera);
	}
}

export { torcsToThree };

