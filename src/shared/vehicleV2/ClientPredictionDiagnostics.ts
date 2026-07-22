// Client-local counters shared by V2 prediction setup and netHealth.
// They never enter gameplay state or replicate; their only purpose is to
// prove whether late-streamed physics descendants exercised the hardening.

let latePhysicsMarks = 0;
let markFailures = 0;

export function noteLatePhysicsMark() {
	latePhysicsMarks += 1;
}

export function notePredictionMarkFailure() {
	markFailures += 1;
}

export function readPredictionSetupDiagnostics() {
	return { latePhysicsMarks, markFailures };
}
