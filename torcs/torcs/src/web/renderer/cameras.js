import * as THREE from "three";
import { SNAPSHOT } from "./runtime.js";
import { torcsToThree } from "./scene.js";

export class CameraRig {
	constructor(canvas) {
		this.mode = "chase";
		this.camera = new THREE.PerspectiveCamera(56, 1, 0.2, 1800);
		this.target = new THREE.Vector3();
		this.canvas = canvas;
	}

	setMode(mode) {
		this.mode = mode;
	}

	updateProjection() {
		const width = Math.max(1, this.canvas.clientWidth);
		const height = Math.max(1, this.canvas.clientHeight);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}

	update(values) {
		const car = torcsToThree(values[SNAPSHOT.x], values[SNAPSHOT.y], values[SNAPSHOT.z]);
		if (this.mode === "top") {
			this.camera.position.set(car.x, 260, car.z);
			this.target.set(car.x, 0, car.z);
			this.camera.up.set(0, 0, -1);
			this.camera.lookAt(this.target);
			return;
		}

		this.camera.up.set(0, 1, 0);
		const yaw = values[SNAPSHOT.yaw];
		const distance = this.mode === "onboard" ? -0.4 : 16;
		const height = this.mode === "onboard" ? 1.2 : 6.2;
		const ahead = this.mode === "onboard" ? 18 : 9;
		const forward = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
		const cameraPos = car.clone()
			.addScaledVector(forward, -distance)
			.add(new THREE.Vector3(0, height, 0));
		this.target.copy(car).addScaledVector(forward, ahead).add(new THREE.Vector3(0, 1.1, 0));
		this.camera.position.copy(cameraPos);
		this.camera.lookAt(this.target);
	}
}
