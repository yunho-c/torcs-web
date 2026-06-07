/***************************************************************************

    file                 : torcs_web_probe.cpp
    created              : Tue Jun 2 2026
    copyright            : (C) 2026 by TORCS contributors
    email                : torcs@free.fr

 ***************************************************************************/

/***************************************************************************
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 ***************************************************************************/

#include <stdio.h>
#include <string.h>
#include <math.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include <tgf.h>
#include <raceman.h>
#include <robottools.h>
#include <track.h>

#include "torcs_web_platform.h"

static const char *RaceEngineConfig = "/torcs/config/raceengine.xml";
static const char *DefaultTrackConfig = "/torcs/data/tracks/e-track-1/e-track-1.xml";
static const char *DefaultCarConfig = "/torcs/data/cars/models/kc-2000gt/kc-2000gt.xml";
static const char *ModulesSection = "Modules";
static const char *MovieCaptureSection = "Movie Capture";
static void *RaceEngineHandle = NULL;

extern "C" int track(tModInfo *modInfo);
extern "C" int simuv2(tModInfo *modInfo);

#define TORCS_WEB_SIM_IDENT 0
#define TORCS_WEB_TRACK_SAMPLES_PER_SEG 12
#define TORCS_WEB_RUNTIME_MAX_CARS 4
#define TORCS_WEB_RUNTIME_SNAPSHOT_VERSION 6
#define TORCS_WEB_RUNTIME_SNAPSHOT_DOUBLE_COUNT 175

enum TorcsWebRuntimeSnapshotField {
	TORCS_WEB_SNAPSHOT_TIME = 0,
	TORCS_WEB_SNAPSHOT_CAR_X,
	TORCS_WEB_SNAPSHOT_CAR_Y,
	TORCS_WEB_SNAPSHOT_CAR_Z,
	TORCS_WEB_SNAPSHOT_CAR_YAW,
	TORCS_WEB_SNAPSHOT_CAR_PITCH,
	TORCS_WEB_SNAPSHOT_CAR_ROLL,
	TORCS_WEB_SNAPSHOT_CAR_SPEED,
	TORCS_WEB_SNAPSHOT_CAR_FUEL,
	TORCS_WEB_SNAPSHOT_CAR_DIMENSION_X,
	TORCS_WEB_SNAPSHOT_CAR_DIMENSION_Y,
	TORCS_WEB_SNAPSHOT_CAR_DIMENSION_Z,
	TORCS_WEB_SNAPSHOT_CAR_STATE,
	TORCS_WEB_SNAPSHOT_CAR_GEAR,
	TORCS_WEB_SNAPSHOT_ENGINE_RPM,
	TORCS_WEB_SNAPSHOT_ENGINE_REDLINE,
	TORCS_WEB_SNAPSHOT_TRACK_SEGMENT_ID,
	TORCS_WEB_SNAPSHOT_TRACK_SEGMENT_TYPE,
	TORCS_WEB_SNAPSHOT_TRACK_TO_START,
	TORCS_WEB_SNAPSHOT_TRACK_TO_RIGHT,
	TORCS_WEB_SNAPSHOT_TRACK_TO_MIDDLE,
	TORCS_WEB_SNAPSHOT_TRACK_DISTANCE_FROM_START,
	TORCS_WEB_SNAPSHOT_RACE_STATE,
	TORCS_WEB_SNAPSHOT_RACE_POSITION,
	TORCS_WEB_SNAPSHOT_LAP_COUNT,
	TORCS_WEB_SNAPSHOT_REMAINING_LAPS,
	TORCS_WEB_SNAPSHOT_LAP_PROGRESS,
	TORCS_WEB_SNAPSHOT_DISTANCE_RACED,
	TORCS_WEB_SNAPSHOT_CURRENT_LAP_TIME,
	TORCS_WEB_SNAPSHOT_LAST_LAP_TIME,
	TORCS_WEB_SNAPSHOT_BEST_LAP_TIME,
	TORCS_WEB_SNAPSHOT_TOP_SPEED,
	TORCS_WEB_SNAPSHOT_CONTROL_STEER,
	TORCS_WEB_SNAPSHOT_CONTROL_ACCEL,
	TORCS_WEB_SNAPSHOT_CONTROL_BRAKE,
	TORCS_WEB_SNAPSHOT_CONTROL_CLUTCH,
	TORCS_WEB_SNAPSHOT_POS_MAT_0,
	TORCS_WEB_SNAPSHOT_CORNER_X_0 = 52,
	TORCS_WEB_SNAPSHOT_CORNER_Y_0 = 56,
	TORCS_WEB_SNAPSHOT_WHEEL_SPIN_VELOCITY_0 = 60,
	TORCS_WEB_SNAPSHOT_WHEEL_SLIP_ACCEL_0 = 64,
	TORCS_WEB_SNAPSHOT_WHEEL_SLIP_SIDE_0 = 68,
	TORCS_WEB_SNAPSHOT_WHEEL_BRAKE_TEMP_0 = 72,
	TORCS_WEB_SNAPSHOT_TRACK_LENGTH = 76,
	TORCS_WEB_SNAPSHOT_TRACK_WIDTH,
	TORCS_WEB_SNAPSHOT_TRACK_SEGMENT_COUNT,
	TORCS_WEB_SNAPSHOT_TRACK_SAMPLE_COUNT,
	TORCS_WEB_SNAPSHOT_WHEEL_REL_X_0,
	TORCS_WEB_SNAPSHOT_WHEEL_REL_Y_0 = 84,
	TORCS_WEB_SNAPSHOT_WHEEL_REL_Z_0 = 88,
	TORCS_WEB_SNAPSHOT_WHEEL_REL_ROLL_0 = 92,
	TORCS_WEB_SNAPSHOT_WHEEL_SPIN_ANGLE_0 = 96,
	TORCS_WEB_SNAPSHOT_WHEEL_STEER_ANGLE_0 = 100,
	TORCS_WEB_SNAPSHOT_WHEEL_RADIUS_0 = 104,
	TORCS_WEB_SNAPSHOT_WHEEL_WIDTH_0 = 108,
	TORCS_WEB_SNAPSHOT_CAR_STEER_LOCK = 112,
	TORCS_WEB_SNAPSHOT_LIGHT_COMMAND,
	TORCS_WEB_SNAPSHOT_COLLISION,
	TORCS_WEB_SNAPSHOT_DAMAGE,
	TORCS_WEB_SNAPSHOT_WHEEL_SKID_0,
	TORCS_WEB_SNAPSHOT_WHEEL_SURFACE_0 = 120,
	TORCS_WEB_SNAPSHOT_WHEEL_REACTION_0 = 124,
	TORCS_WEB_SNAPSHOT_ENGINE_SMOKE = 128,
	TORCS_WEB_SNAPSHOT_EXHAUST_COUNT,
	TORCS_WEB_SNAPSHOT_EXHAUST_POWER,
	TORCS_WEB_SNAPSHOT_EXHAUST_X_0,
	TORCS_WEB_SNAPSHOT_EXHAUST_Y_0 = 133,
	TORCS_WEB_SNAPSHOT_EXHAUST_Z_0 = 135,
	TORCS_WEB_SNAPSHOT_CAR_VEL_X = 137,
	TORCS_WEB_SNAPSHOT_CAR_VEL_Y,
	TORCS_WEB_SNAPSHOT_CAR_VEL_Z,
	TORCS_WEB_SNAPSHOT_GEAR_RATIO,
	TORCS_WEB_SNAPSHOT_GEAR_CHANGE_EVENT,
	TORCS_WEB_SNAPSHOT_COLLISION_EVENT,
	TORCS_WEB_SNAPSHOT_WHEEL_ROUGHNESS_FREQ_0,
	TORCS_WEB_SNAPSHOT_WHEEL_ROUGHNESS_0 = 147,
	TORCS_WEB_SNAPSHOT_WHEEL_OTHER_SURFACE_CONTRIBUTION_0 = 151,
	TORCS_WEB_SNAPSHOT_WHEEL_OTHER_SURFACE_KIND_0 = 155,
	TORCS_WEB_SNAPSHOT_WHEEL_OTHER_ROUGHNESS_FREQ_0 = 159,
	TORCS_WEB_SNAPSHOT_WHEEL_OTHER_ROUGHNESS_0 = 163,
	TORCS_WEB_SNAPSHOT_WHEEL_SURFACE_STYLE_0 = 167,
	TORCS_WEB_SNAPSHOT_WHEEL_OTHER_SURFACE_STYLE_0 = 171
};

struct CarElt;
struct RmInfo;
struct Situation;

typedef void (*tfTorcsWebSimInit)(int nbCars, tTrack *track, tdble fuelFactor, tdble damageFactor, tdble tireFactor);
typedef void (*tfTorcsWebSimConfig)(struct CarElt *carElt, struct RmInfo *reInfo);
typedef void (*tfTorcsWebSimReConfig)(struct CarElt *carElt);
typedef void (*tfTorcsWebSimUpdate)(struct Situation *s, double deltaTime, int telemetry);
typedef void (*tfTorcsWebSimShutdown)(void);

typedef struct TorcsWebSimItf {
	tfTorcsWebSimInit		init;
	tfTorcsWebSimConfig		config;
	tfTorcsWebSimReConfig	reconfig;
	tfTorcsWebSimUpdate		update;
	tfTorcsWebSimShutdown	shutdown;
} tTorcsWebSimItf;

typedef struct TorcsWebRuntime {
	int					active;
	int					simStarted;
	tModList			*trackInfoList;
	tModList			*simInfoList;
	tTrackItf			trackItf;
	tTorcsWebSimItf		simItf;
	tTrack				*trackData;
	void				*carHandle;
	tCarElt			carList[TORCS_WEB_RUNTIME_MAX_CARS];
	tCarElt			*cars[TORCS_WEB_RUNTIME_MAX_CARS];
	int					carCount;
	tSituation			situation;
	tRmInfo			reInfo;
	int					raceProgressReady[TORCS_WEB_RUNTIME_MAX_CARS];
	tdble				previousTrackDistance[TORCS_WEB_RUNTIME_MAX_CARS];
	tdble				totalDistance[TORCS_WEB_RUNTIME_MAX_CARS];
	double				lapStartTime[TORCS_WEB_RUNTIME_MAX_CARS];
	int					previousGear[TORCS_WEB_RUNTIME_MAX_CARS];
	int					gearChangeEvents[TORCS_WEB_RUNTIME_MAX_CARS];
	int					collisionEvents[TORCS_WEB_RUNTIME_MAX_CARS];
} tTorcsWebRuntime;

static tTorcsWebRuntime Runtime;

static int
webProbeModuleInit(int /* index */, void * /* moduleInfo */)
{
	return 0;
}

extern "C" int
web_probe_module(tModInfo *modInfo)
{
	modInfo->name = strdup("webprobe");
	modInfo->desc = strdup("Browser static module probe");
	modInfo->fctInit = webProbeModuleInit;
	modInfo->gfId = 0;
	modInfo->index = 0;
	modInfo->prio = 7;
	return 0;
}

static void
initWebProbe(void)
{
	static int initialized = 0;
	static const tTorcsWebModule WebModules[] = {
		{ "web_probe_module", web_probe_module },
		{ "track", track },
		{ "simuv2", simuv2 }
	};

	if (!initialized) {
		TorcsWebInitPlatform(WebModules, sizeof(WebModules) / sizeof(WebModules[0]));
		GfInit();
		initialized = 1;
	}
}

static void *
loadRaceEngineConfig(void)
{
	if (!RaceEngineHandle) {
		initWebProbe();
		RaceEngineHandle = GfParmReadFile(RaceEngineConfig, GFPARM_RMODE_STD | GFPARM_RMODE_REREAD);
	}

	return RaceEngineHandle;
}

static const char *
fallbackPath(const char *path, const char *fallback)
{
	return path && path[0] != '\0' ? path : fallback;
}

static void
copyModelNameFromPath(const char *path, char *name, size_t nameSize, const char *fallback)
{
	const char *start;
	const char *slash;
	const char *backslash;
	const char *dot;
	size_t len;

	if (!name || nameSize == 0) {
		return;
	}

	start = fallbackPath(path, fallback);
	slash = strrchr(start, '/');
	backslash = strrchr(start, '\\');
	if (slash && (!backslash || slash > backslash)) {
		start = slash + 1;
	} else if (backslash) {
		start = backslash + 1;
	}

	dot = strrchr(start, '.');
	len = dot && dot > start ? (size_t)(dot - start) : strlen(start);
	if (len >= nameSize) {
		len = nameSize - 1;
	}

	memcpy(name, start, len);
	name[len] = '\0';
}

static tCarElt *
getRuntimeCar(int carIndex)
{
	if (!Runtime.active || carIndex < 0 || carIndex >= Runtime.carCount) {
		return NULL;
	}

	return &(Runtime.carList[carIndex]);
}

static int
positionCarOnTrack(tCarElt *car, tTrack *track, const char *carName, int carIndex)
{
	tTrackSeg *seg;
	tdble laneOffset;
	tdble rowOffset;
	tdble width;

	if (!car || !track || !track->seg) {
		return -1;
	}

	memset(car, 0, sizeof(*car));
	car->index = carIndex;
	if (carIndex == 0) {
		strcpy(car->_name, "webprobe");
		car->_driverType = RM_DRV_HUMAN;
	} else {
		snprintf(car->_name, MAX_NAME_LEN, "webai%d", carIndex);
		car->_driverType = RM_DRV_ROBOT;
	}
	strncpy(car->_carName, carName && carName[0] != '\0' ? carName : "kc-2000gt", MAX_NAME_LEN - 1);
	car->_carName[MAX_NAME_LEN - 1] = '\0';
	car->_skillLevel = 0;
	car->_raceNumber = carIndex + 1;
	car->_startRank = carIndex + 1;
	car->_iconColor[0] = carIndex == 0 ? 0.85f : 0.25f + 0.18f * carIndex;
	car->_iconColor[1] = carIndex == 0 ? 0.20f : 0.75f - 0.10f * carIndex;
	car->_iconColor[2] = carIndex == 0 ? 0.16f : 0.35f + 0.14f * carIndex;
	car->_speed_x = 0.0f;
	car->_commitBestLapTime = true;

	seg = track->seg;
	car->_trkPos.seg = seg;
	car->_trkPos.type = TR_LPOS_SEGMENT;
	width = RtTrackGetWidth(seg, 0.0f);
	laneOffset = carIndex == 0 ? 0.0f : ((carIndex % 2) ? -0.22f : 0.22f) * width;
	rowOffset = (tdble)((carIndex + 1) / 2) * 8.0f;
	car->_trkPos.toRight = width * 0.5f + laneOffset;
	if (car->_trkPos.toRight < 1.0f) {
		car->_trkPos.toRight = 1.0f;
	} else if (car->_trkPos.toRight > width - 1.0f) {
		car->_trkPos.toRight = width - 1.0f;
	}
	car->_trkPos.toMiddle = car->_trkPos.toRight - width * 0.5f;

	switch (seg->type) {
		case TR_STR:
			car->_trkPos.toStart = seg->length * 0.5f - rowOffset;
			if (car->_trkPos.toStart < 1.0f) {
				car->_trkPos.toStart = 1.0f;
			}
			car->_yaw = seg->angle[TR_ZS];
			break;
		case TR_RGT:
			car->_trkPos.toStart = seg->arc * 0.5f - rowOffset / seg->radius;
			if (car->_trkPos.toStart < 0.01f) {
				car->_trkPos.toStart = 0.01f;
			}
			car->_yaw = seg->angle[TR_ZS] - car->_trkPos.toStart;
			break;
		case TR_LFT:
			car->_trkPos.toStart = seg->arc * 0.5f - rowOffset / seg->radius;
			if (car->_trkPos.toStart < 0.01f) {
				car->_trkPos.toStart = 0.01f;
			}
			car->_yaw = seg->angle[TR_ZS] + car->_trkPos.toStart;
			break;
		default:
			return -1;
	}

	RtTrackLocal2Global(&(car->_trkPos), &(car->_pos_X), &(car->_pos_Y), TR_TORIGHT);
	car->_pos_Z = RtTrackHeightL(&(car->_trkPos)) + 0.3f;
	NORM0_2PI(car->_yaw);
	return 0;
}

static tdble
clampControl(tdble value, tdble minValue, tdble maxValue)
{
	if (value < minValue) {
		return minValue;
	}
	if (value > maxValue) {
		return maxValue;
	}
	return value;
}

static int
getSurfaceEffectKind(const tTrackSeg *seg)
{
	const char *material;

	if (!seg || !seg->surface || !seg->surface->material) {
		return 0;
	}

	material = seg->surface->material;
	if (strstr(material, "sand")) {
		return 1;
	}
	if (strstr(material, "dirt")) {
		return 2;
	}
	if (strstr(material, "mud")) {
		return 3;
	}
	if (strstr(material, "gravel")) {
		return 4;
	}
	if (strstr(material, "grass")) {
		return 5;
	}
	return 0;
}

static tdble
getSurfaceRoughnessFrequency(const tTrackSeg *seg)
{
	tdble roughnessFreq;

	if (!seg || !seg->surface) {
		return 1.0f;
	}

	roughnessFreq = 2.0f * (tdble)3.14159265358979323846 * seg->surface->kRoughWaveLen;
	if (roughnessFreq > 2.0f) {
		roughnessFreq = 2.0f + (tdble)tanh(roughnessFreq - 2.0f);
	}
	return roughnessFreq;
}

static tdble
getSurfaceRoughness(const tTrackSeg *seg)
{
	return (seg && seg->surface) ? seg->surface->kRoughness : 0.0f;
}

static int
getSurfaceStyle(const tTrackSeg *seg)
{
	return seg ? seg->style : 0;
}

static void
loadCarVisualAttributes(tCarElt *car, void *handle)
{
	int i;
	char path[64];

	if (!car || !handle) {
		return;
	}

	car->_exhaustNb = GfParmGetEltNb(handle, SECT_EXHAUST);
	if (car->_exhaustNb > 2) {
		car->_exhaustNb = 2;
	}
	car->_exhaustPower = GfParmGetNum(handle, SECT_EXHAUST, PRM_POWER, NULL, 1.0f);
	for (i = 0; i < car->_exhaustNb; i++) {
		snprintf(path, sizeof(path), "%s/%d", SECT_EXHAUST, i + 1);
		car->_exhaustPos[i].x = GfParmGetNum(handle, path, PRM_XPOS, NULL, -car->_dimension_x / 2.0f);
		car->_exhaustPos[i].y = -GfParmGetNum(handle, path, PRM_YPOS, NULL, car->_dimension_y / 2.0f);
		car->_exhaustPos[i].z = GfParmGetNum(handle, path, PRM_ZPOS, NULL, 0.1f);
	}
}

static tdble
getCarTrackDistanceFromStart(const tCarElt *car)
{
	tTrackSeg *seg;
	tdble segmentDistance;

	if (!car || !car->_trkPos.seg) {
		return 0.0f;
	}

	seg = car->_trkPos.seg;
	segmentDistance = seg->type == TR_STR ? car->_trkPos.toStart : car->_trkPos.toStart * seg->radius;
	return seg->lgfromstart + segmentDistance;
}

static void
initRuntimeRaceProgress(int carIndex)
{
	tCarElt *car = getRuntimeCar(carIndex);

	if (!Runtime.active || !Runtime.trackData) {
		return;
	}
	if (!car) {
		return;
	}

	Runtime.previousTrackDistance[carIndex] = getCarTrackDistanceFromStart(car);
	Runtime.totalDistance[carIndex] = 0.0f;
	Runtime.lapStartTime[carIndex] = Runtime.situation.currentTime;
	Runtime.raceProgressReady[carIndex] = 1;
	car->_curTime = Runtime.situation.currentTime;
	car->_curLapTime = 0.0;
	car->_lastLapTime = 0.0;
	car->_bestLapTime = 0.0;
	car->_laps = 0;
	car->_remainingLaps = Runtime.situation._totLaps;
	car->_pos = carIndex + 1;
	car->_distFromStartLine = Runtime.previousTrackDistance[carIndex];
	car->_distRaced = Runtime.totalDistance[carIndex];
	car->_topSpeed = car->pub.speed;
}

static void
updateRuntimeRaceProgress(int carIndex)
{
	tCarElt *car = getRuntimeCar(carIndex);
	tdble trackLength;
	tdble currentDistance;
	tdble deltaDistance;

	if (!Runtime.active || !Runtime.trackData || Runtime.trackData->length <= 0.0f) {
		return;
	}
	if (!car) {
		return;
	}

	if (!Runtime.raceProgressReady[carIndex]) {
		initRuntimeRaceProgress(carIndex);
	}

	trackLength = Runtime.trackData->length;
	currentDistance = getCarTrackDistanceFromStart(car);
	deltaDistance = currentDistance - Runtime.previousTrackDistance[carIndex];

	if (deltaDistance < -trackLength * 0.5f) {
		deltaDistance += trackLength;
		car->_laps++;
		if (car->_remainingLaps > 0) {
			car->_remainingLaps--;
		}
		car->_lastLapTime = Runtime.situation.currentTime - Runtime.lapStartTime[carIndex];
		if (car->_lastLapTime > 0.0 &&
			(car->_bestLapTime == 0.0 || car->_lastLapTime < car->_bestLapTime)) {
			car->_bestLapTime = car->_lastLapTime;
		}
		Runtime.lapStartTime[carIndex] = Runtime.situation.currentTime;
	} else if (deltaDistance > trackLength * 0.5f) {
		deltaDistance -= trackLength;
	}

	Runtime.totalDistance[carIndex] += deltaDistance;
	if (Runtime.totalDistance[carIndex] < 0.0f) {
		Runtime.totalDistance[carIndex] = 0.0f;
	}

	Runtime.previousTrackDistance[carIndex] = currentDistance;
	car->_curTime = Runtime.situation.currentTime;
	car->_curLapTime = Runtime.situation.currentTime - Runtime.lapStartTime[carIndex];
	car->_distFromStartLine = currentDistance;
	car->_distRaced = Runtime.totalDistance[carIndex];
	if (car->pub.speed > car->_topSpeed) {
		car->_topSpeed = car->pub.speed;
	}
}

static void
updateRuntimeRacePositions(void)
{
	int i;
	int j;

	for (i = 0; i < Runtime.carCount; i++) {
		int position = 1;
		for (j = 0; j < Runtime.carCount; j++) {
			if (i != j && Runtime.carList[j]._distRaced > Runtime.carList[i]._distRaced) {
				position++;
			}
		}
		Runtime.carList[i]._pos = position;
	}
}

static int
getTrackSample(int sampleIndex, int side, tdble *x, tdble *y)
{
	tTrackSeg *seg;
	tTrkLocPos pos;
	const int segIndex = sampleIndex / TORCS_WEB_TRACK_SAMPLES_PER_SEG;
	const int sampleInSeg = sampleIndex % TORCS_WEB_TRACK_SAMPLES_PER_SEG;
	int i;

	if (!Runtime.active || !Runtime.trackData || !Runtime.trackData->seg ||
		sampleIndex < 0 ||
		sampleIndex >= Runtime.trackData->nseg * TORCS_WEB_TRACK_SAMPLES_PER_SEG ||
		!x || !y) {
		return -1;
	}

	seg = Runtime.trackData->seg;
	for (i = 0; i < segIndex && seg; i++) {
		seg = seg->next;
	}
	if (!seg) {
		return -1;
	}

	memset(&pos, 0, sizeof(pos));
	pos.seg = seg;
	pos.type = TR_LPOS_SEGMENT;
	pos.toStart = (seg->type == TR_STR ? seg->length : seg->arc) *
		((tdble)sampleInSeg / (tdble)TORCS_WEB_TRACK_SAMPLES_PER_SEG);

	switch (side) {
		case 0:
			pos.toRight = 0.0f;
			break;
		case 2:
			pos.toRight = RtTrackGetWidth(seg, pos.toStart);
			break;
		case 1:
		default:
			pos.toRight = RtTrackGetWidth(seg, pos.toStart) * 0.5f;
			break;
	}

	RtTrackLocal2Global(&pos, x, y, TR_TORIGHT);
	return 0;
}

static double
getRuntimeLapProgress(int carIndex)
{
	tCarElt *car = getRuntimeCar(carIndex);

	if (!Runtime.active || !Runtime.trackData || Runtime.trackData->length <= 0.0f || !car) {
		return 0.0;
	}

	return car->_distFromStartLine / Runtime.trackData->length;
}

static void
writeRuntimeSnapshotValues(double *values, int carIndex)
{
	tCarElt *car = getRuntimeCar(carIndex);
	const float *posMat = car ? (const float *)car->_posMat : NULL;
	int i;

	memset(values, 0, sizeof(double) * TORCS_WEB_RUNTIME_SNAPSHOT_DOUBLE_COUNT);
	if (!Runtime.active || !car) {
		return;
	}

	values[TORCS_WEB_SNAPSHOT_TIME] = Runtime.situation.currentTime;
	values[TORCS_WEB_SNAPSHOT_CAR_X] = car->_pos_X;
	values[TORCS_WEB_SNAPSHOT_CAR_Y] = car->_pos_Y;
	values[TORCS_WEB_SNAPSHOT_CAR_Z] = car->_pos_Z;
	values[TORCS_WEB_SNAPSHOT_CAR_YAW] = car->_yaw;
	values[TORCS_WEB_SNAPSHOT_CAR_PITCH] = car->_pitch;
	values[TORCS_WEB_SNAPSHOT_CAR_ROLL] = car->_roll;
	values[TORCS_WEB_SNAPSHOT_CAR_SPEED] = car->pub.speed;
	values[TORCS_WEB_SNAPSHOT_CAR_FUEL] = car->_fuel;
	values[TORCS_WEB_SNAPSHOT_CAR_DIMENSION_X] = car->_dimension_x;
	values[TORCS_WEB_SNAPSHOT_CAR_DIMENSION_Y] = car->_dimension_y;
	values[TORCS_WEB_SNAPSHOT_CAR_DIMENSION_Z] = car->_dimension_z;
	values[TORCS_WEB_SNAPSHOT_CAR_STATE] = car->_state;
	values[TORCS_WEB_SNAPSHOT_CAR_GEAR] = car->_gear;
	values[TORCS_WEB_SNAPSHOT_ENGINE_RPM] = car->_enginerpm;
	values[TORCS_WEB_SNAPSHOT_ENGINE_REDLINE] = car->_enginerpmRedLine;
	values[TORCS_WEB_SNAPSHOT_CAR_VEL_X] = car->pub.DynGCg.vel.x;
	values[TORCS_WEB_SNAPSHOT_CAR_VEL_Y] = car->pub.DynGCg.vel.y;
	values[TORCS_WEB_SNAPSHOT_CAR_VEL_Z] = car->pub.DynGCg.vel.z;
	values[TORCS_WEB_SNAPSHOT_GEAR_RATIO] = car->_gearRatio[car->_gear + car->_gearOffset];
	values[TORCS_WEB_SNAPSHOT_GEAR_CHANGE_EVENT] = Runtime.gearChangeEvents[carIndex];
	values[TORCS_WEB_SNAPSHOT_COLLISION_EVENT] = Runtime.collisionEvents[carIndex];
	values[TORCS_WEB_SNAPSHOT_TRACK_SEGMENT_ID] = car->_trkPos.seg ? car->_trkPos.seg->id : -1;
	values[TORCS_WEB_SNAPSHOT_TRACK_SEGMENT_TYPE] = car->_trkPos.seg ? car->_trkPos.seg->type : 0;
	values[TORCS_WEB_SNAPSHOT_TRACK_TO_START] = car->_trkPos.toStart;
	values[TORCS_WEB_SNAPSHOT_TRACK_TO_RIGHT] = car->_trkPos.toRight;
	values[TORCS_WEB_SNAPSHOT_TRACK_TO_MIDDLE] = car->_trkPos.toMiddle;
	values[TORCS_WEB_SNAPSHOT_TRACK_DISTANCE_FROM_START] = getCarTrackDistanceFromStart(car);
	values[TORCS_WEB_SNAPSHOT_RACE_STATE] = Runtime.situation._raceState;
	values[TORCS_WEB_SNAPSHOT_RACE_POSITION] = car->_pos;
	values[TORCS_WEB_SNAPSHOT_LAP_COUNT] = car->_laps;
	values[TORCS_WEB_SNAPSHOT_REMAINING_LAPS] = car->_remainingLaps;
	values[TORCS_WEB_SNAPSHOT_LAP_PROGRESS] = getRuntimeLapProgress(carIndex);
	values[TORCS_WEB_SNAPSHOT_DISTANCE_RACED] = car->_distRaced;
	values[TORCS_WEB_SNAPSHOT_CURRENT_LAP_TIME] = car->_curLapTime;
	values[TORCS_WEB_SNAPSHOT_LAST_LAP_TIME] = car->_lastLapTime;
	values[TORCS_WEB_SNAPSHOT_BEST_LAP_TIME] = car->_bestLapTime;
	values[TORCS_WEB_SNAPSHOT_TOP_SPEED] = car->_topSpeed;
	values[TORCS_WEB_SNAPSHOT_CONTROL_STEER] = car->ctrl.steer;
	values[TORCS_WEB_SNAPSHOT_CONTROL_ACCEL] = car->ctrl.accelCmd;
	values[TORCS_WEB_SNAPSHOT_CONTROL_BRAKE] = car->ctrl.brakeCmd;
	values[TORCS_WEB_SNAPSHOT_CONTROL_CLUTCH] = car->ctrl.clutchCmd;

	for (i = 0; i < 16; i++) {
		values[TORCS_WEB_SNAPSHOT_POS_MAT_0 + i] = posMat[i];
	}
	for (i = 0; i < 4; i++) {
		values[TORCS_WEB_SNAPSHOT_CORNER_X_0 + i] = car->_corner_x(i);
		values[TORCS_WEB_SNAPSHOT_CORNER_Y_0 + i] = car->_corner_y(i);
		values[TORCS_WEB_SNAPSHOT_WHEEL_SPIN_VELOCITY_0 + i] = car->_wheelSpinVel(i);
		values[TORCS_WEB_SNAPSHOT_WHEEL_SLIP_ACCEL_0 + i] = car->_wheelSlipAccel(i);
		values[TORCS_WEB_SNAPSHOT_WHEEL_SLIP_SIDE_0 + i] = car->_wheelSlipSide(i);
		values[TORCS_WEB_SNAPSHOT_WHEEL_BRAKE_TEMP_0 + i] = car->_brakeTemp(i);
		values[TORCS_WEB_SNAPSHOT_WHEEL_REL_X_0 + i] = car->priv.wheel[i].relPos.x;
		values[TORCS_WEB_SNAPSHOT_WHEEL_REL_Y_0 + i] = car->priv.wheel[i].relPos.y;
		values[TORCS_WEB_SNAPSHOT_WHEEL_REL_Z_0 + i] = car->priv.wheel[i].relPos.z;
		values[TORCS_WEB_SNAPSHOT_WHEEL_REL_ROLL_0 + i] = car->priv.wheel[i].relPos.ax;
		values[TORCS_WEB_SNAPSHOT_WHEEL_SPIN_ANGLE_0 + i] = car->priv.wheel[i].relPos.ay;
		values[TORCS_WEB_SNAPSHOT_WHEEL_STEER_ANGLE_0 + i] = car->priv.wheel[i].relPos.az;
		values[TORCS_WEB_SNAPSHOT_WHEEL_RADIUS_0 + i] = car->_wheelRadius(i);
		values[TORCS_WEB_SNAPSHOT_WHEEL_WIDTH_0 + i] = car->_tireWidth(i);
		values[TORCS_WEB_SNAPSHOT_WHEEL_SKID_0 + i] = car->_skid[i];
		values[TORCS_WEB_SNAPSHOT_WHEEL_SURFACE_0 + i] = getSurfaceEffectKind(car->priv.wheel[i].seg);
		values[TORCS_WEB_SNAPSHOT_WHEEL_REACTION_0 + i] = car->_reaction[i];
		values[TORCS_WEB_SNAPSHOT_WHEEL_ROUGHNESS_FREQ_0 + i] = getSurfaceRoughnessFrequency(car->priv.wheel[i].seg);
		values[TORCS_WEB_SNAPSHOT_WHEEL_ROUGHNESS_0 + i] = getSurfaceRoughness(car->priv.wheel[i].seg);
		values[TORCS_WEB_SNAPSHOT_WHEEL_OTHER_SURFACE_CONTRIBUTION_0 + i] = car->priv.otherSurfaceContribution[i];
		values[TORCS_WEB_SNAPSHOT_WHEEL_OTHER_SURFACE_KIND_0 + i] = getSurfaceEffectKind(car->priv.otherSurfaceSeg[i]);
		values[TORCS_WEB_SNAPSHOT_WHEEL_OTHER_ROUGHNESS_FREQ_0 + i] = getSurfaceRoughnessFrequency(car->priv.otherSurfaceSeg[i]);
		values[TORCS_WEB_SNAPSHOT_WHEEL_OTHER_ROUGHNESS_0 + i] = getSurfaceRoughness(car->priv.otherSurfaceSeg[i]);
		values[TORCS_WEB_SNAPSHOT_WHEEL_SURFACE_STYLE_0 + i] = getSurfaceStyle(car->priv.wheel[i].seg);
		values[TORCS_WEB_SNAPSHOT_WHEEL_OTHER_SURFACE_STYLE_0 + i] = getSurfaceStyle(car->priv.otherSurfaceSeg[i]);
	}
	values[TORCS_WEB_SNAPSHOT_CAR_STEER_LOCK] = car->_steerLock;
	values[TORCS_WEB_SNAPSHOT_LIGHT_COMMAND] = car->_lightCmd;
	values[TORCS_WEB_SNAPSHOT_COLLISION] = car->priv.simcollision;
	values[TORCS_WEB_SNAPSHOT_DAMAGE] = car->_dammage;
	values[TORCS_WEB_SNAPSHOT_ENGINE_SMOKE] = car->priv.smoke;
	values[TORCS_WEB_SNAPSHOT_EXHAUST_COUNT] = car->_exhaustNb;
	values[TORCS_WEB_SNAPSHOT_EXHAUST_POWER] = car->_exhaustPower;
	for (i = 0; i < 2; i++) {
		values[TORCS_WEB_SNAPSHOT_EXHAUST_X_0 + i] = car->_exhaustPos[i].x;
		values[TORCS_WEB_SNAPSHOT_EXHAUST_Y_0 + i] = car->_exhaustPos[i].y;
		values[TORCS_WEB_SNAPSHOT_EXHAUST_Z_0 + i] = car->_exhaustPos[i].z;
	}

	values[TORCS_WEB_SNAPSHOT_TRACK_LENGTH] = Runtime.trackData ? Runtime.trackData->length : 0.0;
	values[TORCS_WEB_SNAPSHOT_TRACK_WIDTH] = Runtime.trackData ? Runtime.trackData->width : 0.0;
	values[TORCS_WEB_SNAPSHOT_TRACK_SEGMENT_COUNT] = Runtime.trackData ? Runtime.trackData->nseg : 0;
	values[TORCS_WEB_SNAPSHOT_TRACK_SAMPLE_COUNT] = Runtime.trackData ? Runtime.trackData->nseg * TORCS_WEB_TRACK_SAMPLES_PER_SEG : 0;
}

static void
updateScriptedDriver(tCarElt *car, int carIndex)
{
	tdble width;
	tdble targetToRight;
	tdble laneOffset;
	tdble steer;
	tdble curveSteer = 0.0f;
	tdble targetSpeed;

	if (!car || !car->_trkPos.seg) {
		return;
	}

	width = RtTrackGetWidth(car->_trkPos.seg, car->_trkPos.toStart);
	laneOffset = ((carIndex % 2) ? -0.18f : 0.18f) * width;
	targetToRight = width * 0.5f + laneOffset;
	steer = (car->_trkPos.toRight - targetToRight) / MAX(width * 0.22f, 1.0f);
	if (car->_trkPos.seg->type == TR_RGT) {
		curveSteer = -0.18f;
	} else if (car->_trkPos.seg->type == TR_LFT) {
		curveSteer = 0.18f;
	}
	car->ctrl.steer = clampControl(steer + curveSteer, -0.75f, 0.75f);

	targetSpeed = 22.0f + (tdble)carIndex * 1.5f;
	if (car->_trkPos.seg->type != TR_STR && car->_trkPos.seg->radius < 140.0f) {
		targetSpeed = 16.0f + (tdble)carIndex;
	}
	if (car->pub.speed < targetSpeed - 1.0f) {
		car->ctrl.accelCmd = 0.72f;
		car->ctrl.brakeCmd = 0.0f;
	} else if (car->pub.speed > targetSpeed + 3.0f) {
		car->ctrl.accelCmd = 0.0f;
		car->ctrl.brakeCmd = 0.18f;
	} else {
		car->ctrl.accelCmd = 0.28f;
		car->ctrl.brakeCmd = 0.0f;
	}
	car->ctrl.clutchCmd = 0.0f;
	if (car->_gear <= 0) {
		car->ctrl.gear = 1;
	} else if (car->_enginerpm > car->_enginerpmRedLine * 0.84f && car->_gear < 6) {
		car->ctrl.gear = car->_gear + 1;
	} else if (car->_enginerpm < car->_enginerpmRedLine * 0.38f && car->_gear > 1) {
		car->ctrl.gear = car->_gear - 1;
	} else {
		car->ctrl.gear = car->_gear;
	}
	car->ctrl.lightCmd = RM_LIGHT_HEAD1 | RM_LIGHT_HEAD2;
}

static void
shutdownRuntime(void)
{
	if (Runtime.simStarted && Runtime.simItf.shutdown) {
		Runtime.simItf.shutdown();
	}
	if (Runtime.carHandle) {
		GfParmReleaseHandle(Runtime.carHandle);
	}
	if (Runtime.trackData && Runtime.trackData->seg && Runtime.trackItf.trkShutdown) {
		Runtime.trackItf.trkShutdown();
	}
	if (Runtime.trackInfoList) {
		GfModFreeInfoList(&(Runtime.trackInfoList));
	}
	if (Runtime.simInfoList) {
		GfModFreeInfoList(&(Runtime.simInfoList));
	}
	memset(&Runtime, 0, sizeof(Runtime));
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
int
torcs_web_probe(void)
{
	void *handle = loadRaceEngineConfig();
	if (!handle) {
		return -1;
	}

	const char *simu = GfParmGetStr(handle, ModulesSection, "simu", "");
	const tdble fps = GfParmGetNum(handle, MovieCaptureSection, "fps", NULL, 0.0f);
	return (simu && simu[0] != '\0' && fps > 0.0f) ? 0 : -1;
}

EMSCRIPTEN_KEEPALIVE
const char *
torcs_web_get_module_name(const char *key)
{
	void *handle = loadRaceEngineConfig();
	if (!handle) {
		return "";
	}

	const char *value = GfParmGetStr(handle, ModulesSection, key, "");
	return value ? value : "";
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_get_capture_fps(void)
{
	void *handle = loadRaceEngineConfig();
	if (!handle) {
		return 0.0;
	}

	const tdble fps = GfParmGetNum(handle, MovieCaptureSection, "fps", NULL, 0.0f);
	return fps;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_check_static_module_registry(void)
{
	tModList *infoList = NULL;
	tModList *loadList = NULL;
	char moduleName[] = "web_probe_module.so";

	initWebProbe();

	if (GfModInfo(0, moduleName, &infoList) < 0 || !infoList) {
		return -1;
	}

	if (!infoList->modInfo[0].name ||
		strcmp(infoList->modInfo[0].name, "webprobe") != 0 ||
		infoList->modInfo[0].prio != 7 ||
		!infoList->modInfo[0].fctInit ||
		infoList->modInfo[0].fctInit(0, NULL) != 0) {
		GfModFreeInfoList(&infoList);
		return -1;
	}

	GfModFreeInfoList(&infoList);

	if (GfModLoad(0, moduleName, &loadList) < 0 || !loadList) {
		return -1;
	}

	GfModUnloadList(&loadList);
	return 0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_check_track_module(void)
{
	tModList *infoList = NULL;
	tTrackItf trackItf;
	char moduleName[] = "track.so";

	initWebProbe();

	if (GfModInfo(TRK_IDENT, moduleName, &infoList) < 0 || !infoList) {
		return -1;
	}

	memset(&trackItf, 0, sizeof(trackItf));

	if (!infoList->modInfo[0].name ||
		strcmp(infoList->modInfo[0].name, "trackv1") != 0 ||
		infoList->modInfo[0].gfId != TRK_IDENT ||
		!infoList->modInfo[0].fctInit ||
		infoList->modInfo[0].fctInit(0, &trackItf) != 0 ||
		!trackItf.trkBuild ||
		!trackItf.trkBuildEx ||
		!trackItf.trkHeightG ||
		!trackItf.trkHeightL ||
		!trackItf.trkGlobal2Local ||
		!trackItf.trkLocal2Global ||
		!trackItf.trkSideNormal ||
		!trackItf.trkSurfaceNormal ||
		!trackItf.trkShutdown) {
		GfModFreeInfoList(&infoList);
		return -1;
	}

	GfModFreeInfoList(&infoList);
	return 0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_check_track_build(void)
{
	tModList *infoList = NULL;
	tTrackItf trackItf;
	tTrack *trackData;
	char moduleName[] = "track.so";
	char trackFile[] = "/torcs/data/tracks/e-track-1/e-track-1.xml";
	int result = -1;

	initWebProbe();

	if (GfModInfo(TRK_IDENT, moduleName, &infoList) < 0 || !infoList) {
		return -1;
	}

	memset(&trackItf, 0, sizeof(trackItf));
	if (!infoList->modInfo[0].fctInit || infoList->modInfo[0].fctInit(0, &trackItf) != 0 || !trackItf.trkBuild) {
		GfModFreeInfoList(&infoList);
		return -1;
	}

	trackData = trackItf.trkBuild(trackFile);
	if (trackData &&
		trackData->seg &&
		trackData->name &&
		strcmp(trackData->name, "E-Track 1") == 0 &&
		trackData->version == 4 &&
		trackData->nseg > 0 &&
		trackData->length > 0.0f &&
		trackData->width > 0.0f) {
		result = 0;
	}

	if (trackData && trackData->seg && trackItf.trkShutdown) {
		trackItf.trkShutdown();
	}

	GfModFreeInfoList(&infoList);
	return result;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_check_simuv2_module(void)
{
	tModList *infoList = NULL;
	tTorcsWebSimItf simItf;
	char moduleName[] = "simuv2.so";

	initWebProbe();

	if (GfModInfo(TORCS_WEB_SIM_IDENT, moduleName, &infoList) < 0 || !infoList) {
		return -1;
	}

	memset(&simItf, 0, sizeof(simItf));

	if (!infoList->modInfo[0].name ||
		strcmp(infoList->modInfo[0].name, "simu") != 0 ||
		infoList->modInfo[0].gfId != TORCS_WEB_SIM_IDENT ||
		!infoList->modInfo[0].fctInit ||
		infoList->modInfo[0].fctInit(0, &simItf) != 0 ||
		!simItf.init ||
		!simItf.config ||
		!simItf.reconfig ||
		!simItf.update ||
		!simItf.shutdown) {
		GfModFreeInfoList(&infoList);
		return -1;
	}

	GfModFreeInfoList(&infoList);
	return 0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_check_headless_sim_init(void)
{
	tModList *trackInfoList = NULL;
	tModList *simInfoList = NULL;
	tTrackItf trackItf;
	tTorcsWebSimItf simItf;
	tTrack *trackData = NULL;
	char trackModuleName[] = "track.so";
	char simModuleName[] = "simuv2.so";
	char trackFile[] = "/torcs/data/tracks/e-track-1/e-track-1.xml";
	int result = -1;

	initWebProbe();
	memset(&trackItf, 0, sizeof(trackItf));
	memset(&simItf, 0, sizeof(simItf));

	if (GfModInfo(TRK_IDENT, trackModuleName, &trackInfoList) < 0 || !trackInfoList ||
		GfModInfo(TORCS_WEB_SIM_IDENT, simModuleName, &simInfoList) < 0 || !simInfoList) {
		goto cleanup;
	}

	if (!trackInfoList->modInfo[0].fctInit ||
		trackInfoList->modInfo[0].fctInit(0, &trackItf) != 0 ||
		!trackItf.trkBuild ||
		!trackItf.trkShutdown ||
		!simInfoList->modInfo[0].fctInit ||
		simInfoList->modInfo[0].fctInit(0, &simItf) != 0 ||
		!simItf.init ||
		!simItf.shutdown) {
		goto cleanup;
	}

	trackData = trackItf.trkBuild(trackFile);
	if (!trackData || !trackData->seg) {
		goto cleanup;
	}

	simItf.init(0, trackData, 1.0f, 1.0f, 1.0f);
	simItf.shutdown();
	result = 0;

cleanup:
	if (trackData && trackData->seg && trackItf.trkShutdown) {
		trackItf.trkShutdown();
	}
	if (trackInfoList) {
		GfModFreeInfoList(&trackInfoList);
	}
	if (simInfoList) {
		GfModFreeInfoList(&simInfoList);
	}
	return result;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_check_headless_sim_update(void)
{
	tModList *trackInfoList = NULL;
	tModList *simInfoList = NULL;
	tTrackItf trackItf;
	tTorcsWebSimItf simItf;
	tTrack *trackData = NULL;
	void *carHandle = NULL;
	tCarElt car;
	tCarElt *cars[1];
	tSituation situation;
	tRmInfo reInfo;
	char carName[MAX_NAME_LEN];
	char trackModuleName[] = "track.so";
	char simModuleName[] = "simuv2.so";
	char trackFile[] = "/torcs/data/tracks/e-track-1/e-track-1.xml";
	tdble startZ;
	int result = -1;

	initWebProbe();
	memset(&trackItf, 0, sizeof(trackItf));
	memset(&simItf, 0, sizeof(simItf));

	if (GfModInfo(TRK_IDENT, trackModuleName, &trackInfoList) < 0 || !trackInfoList ||
		GfModInfo(TORCS_WEB_SIM_IDENT, simModuleName, &simInfoList) < 0 || !simInfoList) {
		goto cleanup;
	}

	if (!trackInfoList->modInfo[0].fctInit ||
		trackInfoList->modInfo[0].fctInit(0, &trackItf) != 0 ||
		!trackItf.trkBuild ||
		!trackItf.trkShutdown ||
		!simInfoList->modInfo[0].fctInit ||
		simInfoList->modInfo[0].fctInit(0, &simItf) != 0 ||
		!simItf.init ||
		!simItf.config ||
		!simItf.update ||
		!simItf.shutdown) {
		goto cleanup;
	}

	trackData = trackItf.trkBuild(trackFile);
	carHandle = GfParmReadFile(DefaultCarConfig, GFPARM_RMODE_STD | GFPARM_RMODE_REREAD);
	if (!trackData || !trackData->seg || !carHandle) {
		goto cleanup;
	}

	copyModelNameFromPath(DefaultCarConfig, carName, sizeof(carName), "kc-2000gt");
	if (positionCarOnTrack(&car, trackData, carName, 0) != 0) {
		goto cleanup;
	}
	car._carHandle = carHandle;
	startZ = car._pos_Z;

	memset(&situation, 0, sizeof(situation));
	memset(&reInfo, 0, sizeof(reInfo));
	cars[0] = &car;
	situation._ncars = 1;
	situation._raceState = RM_RACE_RUNNING;
	situation._raceType = RM_TYPE_PRACTICE;
	situation.cars = cars;
	reInfo.carList = &car;
	reInfo.s = &situation;
	reInfo.track = trackData;

	simItf.init(1, trackData, 1.0f, 1.0f, 1.0f);
	simItf.config(&car, &reInfo);
	car.ctrl.gear = 0;
	car.ctrl.accelCmd = 0.0f;
	car.ctrl.brakeCmd = 0.0f;
	car.ctrl.clutchCmd = 1.0f;
	simItf.update(&situation, RCM_MAX_DT_SIMU, -1);
	simItf.shutdown();

	if (car._trkPos.seg &&
		car._dimension_x > 0.0f &&
		car._dimension_y > 0.0f &&
		car._fuel > 0.0f &&
		car._pos_Z > startZ - 1.0f &&
		car._pos_Z < startZ + 1.0f &&
		car.pub.speed >= 0.0f &&
		car.pub.speed < 100.0f) {
		result = 0;
	}

cleanup:
	if (carHandle) {
		GfParmReleaseHandle(carHandle);
	}
	if (trackData && trackData->seg && trackItf.trkShutdown) {
		trackItf.trkShutdown();
	}
	if (trackInfoList) {
		GfModFreeInfoList(&trackInfoList);
	}
	if (simInfoList) {
		GfModFreeInfoList(&simInfoList);
	}
	return result;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_start_multi_with_files(const char *trackFile, const char *carFile, int carCount)
{
	char trackModuleName[] = "track.so";
	char simModuleName[] = "simuv2.so";
	char carName[MAX_NAME_LEN];
	const char *selectedTrackFile = fallbackPath(trackFile, DefaultTrackConfig);
	const char *selectedCarFile = fallbackPath(carFile, DefaultCarConfig);
	int i;

	shutdownRuntime();
	initWebProbe();
	if (carCount < 1) {
		carCount = 1;
	} else if (carCount > TORCS_WEB_RUNTIME_MAX_CARS) {
		carCount = TORCS_WEB_RUNTIME_MAX_CARS;
	}

	if (GfModInfo(TRK_IDENT, trackModuleName, &(Runtime.trackInfoList)) < 0 || !Runtime.trackInfoList ||
		GfModInfo(TORCS_WEB_SIM_IDENT, simModuleName, &(Runtime.simInfoList)) < 0 || !Runtime.simInfoList) {
		shutdownRuntime();
		return -1;
	}

	if (!Runtime.trackInfoList->modInfo[0].fctInit ||
		Runtime.trackInfoList->modInfo[0].fctInit(0, &(Runtime.trackItf)) != 0 ||
		!Runtime.trackItf.trkBuild ||
		!Runtime.trackItf.trkShutdown ||
		!Runtime.simInfoList->modInfo[0].fctInit ||
		Runtime.simInfoList->modInfo[0].fctInit(0, &(Runtime.simItf)) != 0 ||
		!Runtime.simItf.init ||
		!Runtime.simItf.config ||
		!Runtime.simItf.update ||
		!Runtime.simItf.shutdown) {
		shutdownRuntime();
		return -1;
	}

	Runtime.trackData = Runtime.trackItf.trkBuild((char *)selectedTrackFile);
	Runtime.carHandle = GfParmReadFile(selectedCarFile, GFPARM_RMODE_STD | GFPARM_RMODE_REREAD);
	copyModelNameFromPath(selectedCarFile, carName, sizeof(carName), "kc-2000gt");
	if (!Runtime.trackData || !Runtime.trackData->seg || !Runtime.carHandle) {
		shutdownRuntime();
		return -1;
	}

	Runtime.carCount = carCount;
	for (i = 0; i < Runtime.carCount; i++) {
		if (positionCarOnTrack(&(Runtime.carList[i]), Runtime.trackData, carName, i) != 0) {
			shutdownRuntime();
			return -1;
		}
		Runtime.carList[i]._carHandle = Runtime.carHandle;
		Runtime.cars[i] = &(Runtime.carList[i]);
	}
	Runtime.situation._ncars = Runtime.carCount;
	Runtime.situation.nbPlayers = 1;
	Runtime.situation._totLaps = 3;
	Runtime.situation._raceState = RM_RACE_RUNNING;
	Runtime.situation._raceType = RM_TYPE_PRACTICE;
	Runtime.situation.cars = Runtime.cars;
	Runtime.reInfo.carList = Runtime.carList;
	Runtime.reInfo.s = &(Runtime.situation);
	Runtime.reInfo.track = Runtime.trackData;

	Runtime.simItf.init(Runtime.carCount, Runtime.trackData, 1.0f, 1.0f, 1.0f);
	Runtime.simStarted = 1;
	for (i = 0; i < Runtime.carCount; i++) {
		Runtime.simItf.config(&(Runtime.carList[i]), &(Runtime.reInfo));
		loadCarVisualAttributes(&(Runtime.carList[i]), Runtime.carHandle);
		Runtime.carList[i].ctrl.gear = i == 0 ? 0 : 1;
		Runtime.carList[i].ctrl.accelCmd = 0.0f;
		Runtime.carList[i].ctrl.brakeCmd = 0.0f;
		Runtime.carList[i].ctrl.clutchCmd = i == 0 ? 1.0f : 0.0f;
		Runtime.carList[i].ctrl.lightCmd = RM_LIGHT_HEAD1 | RM_LIGHT_HEAD2;
		Runtime.previousGear[i] = Runtime.carList[i]._gear;
		Runtime.gearChangeEvents[i] = 0;
		Runtime.collisionEvents[i] = 0;
	}
	Runtime.active = 1;
	for (i = 0; i < Runtime.carCount; i++) {
		initRuntimeRaceProgress(i);
	}
	updateRuntimeRacePositions();
	return 0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_start_with_files(const char *trackFile, const char *carFile)
{
	return torcs_web_runtime_start_multi_with_files(trackFile, carFile, 1);
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_start(void)
{
	return torcs_web_runtime_start_with_files(DefaultTrackConfig, DefaultCarConfig);
}

EMSCRIPTEN_KEEPALIVE
void
torcs_web_runtime_shutdown(void)
{
	shutdownRuntime();
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_set_controls(double steer, double accel, double brake, double clutch, int gear)
{
	tCarElt *car = getRuntimeCar(0);

	if (!Runtime.active) {
		return -1;
	}
	if (!car) {
		return -1;
	}

	car->ctrl.steer = clampControl((tdble)steer, -1.0f, 1.0f);
	car->ctrl.accelCmd = clampControl((tdble)accel, 0.0f, 1.0f);
	car->ctrl.brakeCmd = clampControl((tdble)brake, 0.0f, 1.0f);
	car->ctrl.clutchCmd = clampControl((tdble)clutch, 0.0f, 1.0f);
	car->ctrl.gear = gear;
	return 0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_step(double deltaTime)
{
	double remaining;
	double step;
	int i;

	if (!Runtime.active || !Runtime.simItf.update) {
		return -1;
	}

	remaining = deltaTime > 0.0 ? deltaTime : RCM_MAX_DT_SIMU;
	if (remaining > 0.25) {
		remaining = 0.25;
	}

	while (remaining > 0.0) {
		step = remaining > RCM_MAX_DT_SIMU ? RCM_MAX_DT_SIMU : remaining;
		Runtime.situation.deltaTime = step;
		for (i = 1; i < Runtime.carCount; i++) {
			updateScriptedDriver(&(Runtime.carList[i]), i);
		}
		Runtime.simItf.update(&(Runtime.situation), step, -1);
		for (i = 0; i < Runtime.carCount; i++) {
			if (Runtime.carList[i]._gear != Runtime.previousGear[i]) {
				Runtime.gearChangeEvents[i]++;
				Runtime.previousGear[i] = Runtime.carList[i]._gear;
			}
			Runtime.collisionEvents[i] |= Runtime.carList[i].priv.collision;
			Runtime.carList[i].priv.collision = 0;
		}
		Runtime.situation.currentTime += step;
		for (i = 0; i < Runtime.carCount; i++) {
			updateRuntimeRaceProgress(i);
		}
		updateRuntimeRacePositions();
		remaining -= step;
	}

	return 0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_time(void)
{
	return Runtime.active ? Runtime.situation.currentTime : 0.0;
}

EMSCRIPTEN_KEEPALIVE
const char *
torcs_web_runtime_get_track_name(void)
{
	return Runtime.active && Runtime.trackData && Runtime.trackData->name ? Runtime.trackData->name : "";
}

EMSCRIPTEN_KEEPALIVE
const char *
torcs_web_runtime_get_car_name(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_carName : "";
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_x(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_pos_X : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_y(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_pos_Y : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_z(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_pos_Z : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_yaw(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_yaw : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_speed(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->pub.speed : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_fuel(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_fuel : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_dimension_x(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_dimension_x : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_dimension_y(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_dimension_y : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_dimension_z(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_dimension_z : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_corner_x(int cornerIndex)
{
	tCarElt *car = getRuntimeCar(0);
	if (!car || cornerIndex < 0 || cornerIndex >= 4) {
		return 0.0;
	}

	return car->_corner_x(cornerIndex);
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_corner_y(int cornerIndex)
{
	tCarElt *car = getRuntimeCar(0);
	if (!car || cornerIndex < 0 || cornerIndex >= 4) {
		return 0.0;
	}

	return car->_corner_y(cornerIndex);
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_car_track_segment_id(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car && car->_trkPos.seg ? car->_trkPos.seg->id : -1;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_car_track_segment_type(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car && car->_trkPos.seg ? car->_trkPos.seg->type : 0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_track_to_start(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_trkPos.toStart : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_track_to_right(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_trkPos.toRight : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_track_to_middle(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_trkPos.toMiddle : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_track_distance_from_start(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? getCarTrackDistanceFromStart(car) : 0.0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_race_state(void)
{
	return Runtime.active ? Runtime.situation._raceState : 0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_race_position(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_pos : 0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_lap_count(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_laps : 0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_remaining_laps(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_remainingLaps : 0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_lap_progress(void)
{
	return getRuntimeLapProgress(0);
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_distance_raced(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_distRaced : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_current_lap_time(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_curLapTime : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_last_lap_time(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_lastLapTime : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_best_lap_time(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_bestLapTime : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_top_speed(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_topSpeed : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_engine_rpm(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_enginerpm : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_engine_redline(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_enginerpmRedLine : 0.0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_gear(void)
{
	tCarElt *car = getRuntimeCar(0);
	return car ? car->_gear : 0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_wheel_spin_velocity(int wheelIndex)
{
	tCarElt *car = getRuntimeCar(0);
	if (!car || wheelIndex < 0 || wheelIndex >= 4) {
		return 0.0;
	}

	return car->_wheelSpinVel(wheelIndex);
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_wheel_slip_accel(int wheelIndex)
{
	tCarElt *car = getRuntimeCar(0);
	if (!car || wheelIndex < 0 || wheelIndex >= 4) {
		return 0.0;
	}

	return car->_wheelSlipAccel(wheelIndex);
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_wheel_slip_side(int wheelIndex)
{
	tCarElt *car = getRuntimeCar(0);
	if (!car || wheelIndex < 0 || wheelIndex >= 4) {
		return 0.0;
	}

	return car->_wheelSlipSide(wheelIndex);
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_track_length(void)
{
	return Runtime.active && Runtime.trackData ? Runtime.trackData->length : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_track_width(void)
{
	return Runtime.active && Runtime.trackData ? Runtime.trackData->width : 0.0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_track_segment_count(void)
{
	return Runtime.active && Runtime.trackData ? Runtime.trackData->nseg : 0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_track_sample_count(void)
{
	return Runtime.active && Runtime.trackData ? Runtime.trackData->nseg * TORCS_WEB_TRACK_SAMPLES_PER_SEG : 0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_track_sample_x(int sampleIndex, int side)
{
	tdble x = 0.0f;
	tdble y = 0.0f;

	return getTrackSample(sampleIndex, side, &x, &y) == 0 ? x : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_track_sample_y(int sampleIndex, int side)
{
	tdble x = 0.0f;
	tdble y = 0.0f;

	return getTrackSample(sampleIndex, side, &x, &y) == 0 ? y : 0.0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_snapshot_version(void)
{
	return TORCS_WEB_RUNTIME_SNAPSHOT_VERSION;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_snapshot_size(void)
{
	return (int)(sizeof(double) * TORCS_WEB_RUNTIME_SNAPSHOT_DOUBLE_COUNT);
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_max_cars(void)
{
	return TORCS_WEB_RUNTIME_MAX_CARS;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_car_count(void)
{
	return Runtime.active ? Runtime.carCount : 0;
}

EMSCRIPTEN_KEEPALIVE
const char *
torcs_web_runtime_get_car_name_by_index(int carIndex)
{
	tCarElt *car = getRuntimeCar(carIndex);
	return car ? car->_name : "";
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_write_car_snapshot(int carIndex, void *buffer, int byteSize)
{
	if (!buffer || byteSize < torcs_web_runtime_get_snapshot_size()) {
		return -1;
	}
	if (!getRuntimeCar(carIndex)) {
		memset(buffer, 0, torcs_web_runtime_get_snapshot_size());
		return -1;
	}

	writeRuntimeSnapshotValues((double *)buffer, carIndex);
	Runtime.gearChangeEvents[carIndex] = 0;
	Runtime.collisionEvents[carIndex] = 0;
	return 0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_write_snapshot(void *buffer, int byteSize)
{
	if (!buffer || byteSize < torcs_web_runtime_get_snapshot_size()) {
		return -1;
	}

	return torcs_web_runtime_write_car_snapshot(0, buffer, byteSize);
}

}

int
main(int /* argc */, char ** /* argv */)
{
	const int result = torcs_web_probe();
	printf("TORCS web probe: %s\n", result == 0 ? "ok" : "failed");
	return result;
}
