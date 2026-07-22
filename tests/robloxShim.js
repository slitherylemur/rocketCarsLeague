// Minimal Roblox datatype/global shim for running the PURE V2 math modules
// (shared/vehicleV2/CarMath.ts, CorrectionPolicy.ts, CarState.ts) under Node.
// Only what those modules touch is implemented. Loaded by tools/runTests.js.

"use strict";

class Vector3 {
	constructor(x = 0, y = 0, z = 0) {
		this.X = x;
		this.Y = y;
		this.Z = z;
	}
	add(v) {
		return new Vector3(this.X + v.X, this.Y + v.Y, this.Z + v.Z);
	}
	sub(v) {
		return new Vector3(this.X - v.X, this.Y - v.Y, this.Z - v.Z);
	}
	mul(s) {
		if (typeof s === "number") return new Vector3(this.X * s, this.Y * s, this.Z * s);
		return new Vector3(this.X * s.X, this.Y * s.Y, this.Z * s.Z);
	}
	div(s) {
		if (typeof s === "number") return new Vector3(this.X / s, this.Y / s, this.Z / s);
		return new Vector3(this.X / s.X, this.Y / s.Y, this.Z / s.Z);
	}
	Dot(v) {
		return this.X * v.X + this.Y * v.Y + this.Z * v.Z;
	}
	Cross(v) {
		return new Vector3(
			this.Y * v.Z - this.Z * v.Y,
			this.Z * v.X - this.X * v.Z,
			this.X * v.Y - this.Y * v.X,
		);
	}
	get Magnitude() {
		return Math.sqrt(this.Dot(this));
	}
	get Unit() {
		const m = this.Magnitude;
		return m > 0 ? this.div(m) : new Vector3(0, 0, 0);
	}
}

// Rotation stored as a row-major 3x3 (m[r][c]); columns are the basis vectors
// (XVector, YVector, ZVector) like Roblox.
function matIdentity() {
	return [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1],
	];
}
function matMul(a, b) {
	const out = matIdentity();
	for (let r = 0; r < 3; r++)
		for (let c = 0; c < 3; c++) out[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
	return out;
}
function matTranspose(a) {
	return [
		[a[0][0], a[1][0], a[2][0]],
		[a[0][1], a[1][1], a[2][1]],
		[a[0][2], a[1][2], a[2][2]],
	];
}
function matVec(a, v) {
	return new Vector3(
		a[0][0] * v.X + a[0][1] * v.Y + a[0][2] * v.Z,
		a[1][0] * v.X + a[1][1] * v.Y + a[1][2] * v.Z,
		a[2][0] * v.X + a[2][1] * v.Y + a[2][2] * v.Z,
	);
}
function axisAngleMat(axis, angle) {
	const u = axis.Unit;
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const t = 1 - c;
	const { X: x, Y: y, Z: z } = u;
	return [
		[t * x * x + c, t * x * y - s * z, t * x * z + s * y],
		[t * x * y + s * z, t * y * y + c, t * y * z - s * x],
		[t * x * z - s * y, t * y * z + s * x, t * z * z + c],
	];
}
function matToQuat(m) {
	const tr = m[0][0] + m[1][1] + m[2][2];
	let w, x, y, z;
	if (tr > 0) {
		const s = Math.sqrt(tr + 1) * 2;
		w = s / 4;
		x = (m[2][1] - m[1][2]) / s;
		y = (m[0][2] - m[2][0]) / s;
		z = (m[1][0] - m[0][1]) / s;
	} else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
		const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
		w = (m[2][1] - m[1][2]) / s;
		x = s / 4;
		y = (m[0][1] + m[1][0]) / s;
		z = (m[0][2] + m[2][0]) / s;
	} else if (m[1][1] > m[2][2]) {
		const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
		w = (m[0][2] - m[2][0]) / s;
		x = (m[0][1] + m[1][0]) / s;
		y = s / 4;
		z = (m[1][2] + m[2][1]) / s;
	} else {
		const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
		w = (m[1][0] - m[0][1]) / s;
		x = (m[0][2] + m[2][0]) / s;
		y = (m[1][2] + m[2][1]) / s;
		z = s / 4;
	}
	return [w, x, y, z];
}
function quatToMat(q) {
	const [w, x, y, z] = q;
	return [
		[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
		[2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
		[2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
	];
}
function quatSlerp(a, b, t) {
	let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
	let bb = b;
	if (dot < 0) {
		bb = b.map((v) => -v);
		dot = -dot;
	}
	if (dot > 0.9995) {
		const out = a.map((v, i) => v + t * (bb[i] - v));
		const n = Math.hypot(...out);
		return out.map((v) => v / n);
	}
	const theta = Math.acos(Math.min(1, dot));
	const sinTheta = Math.sin(theta);
	const wa = Math.sin((1 - t) * theta) / sinTheta;
	const wb = Math.sin(t * theta) / sinTheta;
	return a.map((v, i) => wa * v + wb * bb[i]);
}

class CFrame {
	constructor(a, b, c) {
		if (a === undefined) {
			this.p = new Vector3();
			this.m = matIdentity();
		} else if (a instanceof Vector3) {
			this.p = a;
			this.m = matIdentity();
		} else {
			this.p = new Vector3(a, b, c);
			this.m = matIdentity();
		}
	}
	static _fromMat(p, m) {
		const cf = new CFrame();
		cf.p = p;
		cf.m = m;
		return cf;
	}
	static Angles(rx, ry, rz) {
		const mx = axisAngleMat(new Vector3(1, 0, 0), rx);
		const my = axisAngleMat(new Vector3(0, 1, 0), ry);
		const mz = axisAngleMat(new Vector3(0, 0, 1), rz);
		return CFrame._fromMat(new Vector3(), matMul(matMul(mx, my), mz));
	}
	static fromAxisAngle(axis, angle) {
		return CFrame._fromMat(new Vector3(), axisAngleMat(axis, angle));
	}
	get Position() {
		return this.p;
	}
	get Rotation() {
		return CFrame._fromMat(new Vector3(), this.m);
	}
	get XVector() {
		return new Vector3(this.m[0][0], this.m[1][0], this.m[2][0]);
	}
	get YVector() {
		return new Vector3(this.m[0][1], this.m[1][1], this.m[2][1]);
	}
	get ZVector() {
		return new Vector3(this.m[0][2], this.m[1][2], this.m[2][2]);
	}
	get UpVector() {
		return this.YVector;
	}
	get RightVector() {
		return this.XVector;
	}
	get LookVector() {
		return this.ZVector.mul(-1);
	}
	mul(other) {
		if (other instanceof CFrame) {
			return CFrame._fromMat(this.p.add(matVec(this.m, other.p)), matMul(this.m, other.m));
		}
		throw new Error("CFrame.mul: unsupported operand");
	}
	add(v) {
		return CFrame._fromMat(this.p.add(v), this.m);
	}
	Inverse() {
		const mt = matTranspose(this.m);
		return CFrame._fromMat(matVec(mt, this.p).mul(-1), mt);
	}
	VectorToObjectSpace(v) {
		return matVec(matTranspose(this.m), v);
	}
	VectorToWorldSpace(v) {
		return matVec(this.m, v);
	}
	PointToObjectSpace(v) {
		return matVec(matTranspose(this.m), v.sub(this.p));
	}
	PointToWorldSpace(v) {
		return this.p.add(matVec(this.m, v));
	}
	ToObjectSpace(other) {
		return this.Inverse().mul(other);
	}
	Lerp(target, alpha) {
		const q = quatSlerp(matToQuat(this.m), matToQuat(target.m), alpha);
		const p = this.p.add(target.p.sub(this.p).mul(alpha));
		return CFrame._fromMat(p, quatToMat(q));
	}
	ToAxisAngle() {
		const [w, x, y, z] = matToQuat(this.m);
		const s = Math.hypot(x, y, z);
		const angle = 2 * Math.atan2(s, w);
		const axis = s > 1e-9 ? new Vector3(x / s, y / s, z / s) : new Vector3(1, 0, 0);
		return [axis, angle];
	}
	GetComponents() {
		const m = this.m;
		return [this.p.X, this.p.Y, this.p.Z, m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2]];
	}
}

const mathShim = Object.create(null);
for (const k of ["abs", "ceil", "floor", "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "exp", "log", "pow", "min", "max", "round"]) {
	mathShim[k] = Math[k].bind(Math);
}
mathShim.huge = Infinity;
mathShim.pi = Math.PI;
mathShim.rad = (d) => (d * Math.PI) / 180;
mathShim.deg = (r) => (r * 180) / Math.PI;
mathShim.clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
mathShim.atan2 = Math.atan2.bind(Math);

function installGlobals(target) {
	target.Vector3 = Vector3;
	target.CFrame = CFrame;
	target.math = mathShim;
	target.warn = (...args) => console.warn("[warn]", ...args);
	target.print = (...args) => console.log(...args);
	target.pairs = (obj) => Object.entries(obj);
	target.ipairs = (arr) => arr.map((v, i) => [i + 1, v]);
	target.typeIs = (value, ty) => {
		if (ty === "number") return typeof value === "number";
		if (ty === "string") return typeof value === "string";
		if (ty === "boolean") return typeof value === "boolean";
		if (ty === "Vector3") return value instanceof Vector3;
		if (ty === "CFrame") return value instanceof CFrame;
		if (ty === "table") return typeof value === "object" && value !== null;
		return false;
	};
	// roblox-ts .size() macros on arrays/strings.
	if (!Array.prototype.size) {
		Object.defineProperty(Array.prototype, "size", {
			value: function () {
				return this.length;
			},
		});
	}
	if (!String.prototype.size) {
		Object.defineProperty(String.prototype, "size", {
			value: function () {
				return this.length;
			},
		});
	}
}

module.exports = { Vector3, CFrame, math: mathShim, installGlobals };
