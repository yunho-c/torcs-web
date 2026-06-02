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
static const char *CarConfig = "/torcs/data/cars/models/kc-2000gt/kc-2000gt.xml";
static const char *ModulesSection = "Modules";
static const char *MovieCaptureSection = "Movie Capture";
static void *RaceEngineHandle = NULL;

extern "C" int track(tModInfo *modInfo);
extern "C" int simuv2(tModInfo *modInfo);

#define TORCS_WEB_SIM_IDENT 0
#define TORCS_WEB_TRACK_SAMPLES_PER_SEG 12

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
	tCarElt			car;
	tCarElt			*cars[1];
	tSituation			situation;
	tRmInfo			reInfo;
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

static int
positionCarOnTrack(tCarElt *car, tTrack *track)
{
	tTrackSeg *seg;

	if (!car || !track || !track->seg) {
		return -1;
	}

	memset(car, 0, sizeof(*car));
	car->index = 0;
	strcpy(car->_name, "webprobe");
	strcpy(car->_carName, "kc-2000gt");
	car->_skillLevel = 0;
	car->_speed_x = 0.0f;
	car->_commitBestLapTime = true;

	seg = track->seg;
	car->_trkPos.seg = seg;
	car->_trkPos.type = TR_LPOS_SEGMENT;
	car->_trkPos.toRight = seg->width * 0.5f;

	switch (seg->type) {
		case TR_STR:
			car->_trkPos.toStart = seg->length * 0.5f;
			car->_yaw = seg->angle[TR_ZS];
			break;
		case TR_RGT:
			car->_trkPos.toStart = seg->arc * 0.5f;
			car->_yaw = seg->angle[TR_ZS] - car->_trkPos.toStart;
			break;
		case TR_LFT:
			car->_trkPos.toStart = seg->arc * 0.5f;
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
	carHandle = GfParmReadFile(CarConfig, GFPARM_RMODE_STD | GFPARM_RMODE_REREAD);
	if (!trackData || !trackData->seg || !carHandle) {
		goto cleanup;
	}

	if (positionCarOnTrack(&car, trackData) != 0) {
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
torcs_web_runtime_start(void)
{
	char trackModuleName[] = "track.so";
	char simModuleName[] = "simuv2.so";
	char trackFile[] = "/torcs/data/tracks/e-track-1/e-track-1.xml";

	shutdownRuntime();
	initWebProbe();

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

	Runtime.trackData = Runtime.trackItf.trkBuild(trackFile);
	Runtime.carHandle = GfParmReadFile(CarConfig, GFPARM_RMODE_STD | GFPARM_RMODE_REREAD);
	if (!Runtime.trackData || !Runtime.trackData->seg || !Runtime.carHandle ||
		positionCarOnTrack(&(Runtime.car), Runtime.trackData) != 0) {
		shutdownRuntime();
		return -1;
	}

	Runtime.car._carHandle = Runtime.carHandle;
	Runtime.cars[0] = &(Runtime.car);
	Runtime.situation._ncars = 1;
	Runtime.situation._raceState = RM_RACE_RUNNING;
	Runtime.situation._raceType = RM_TYPE_PRACTICE;
	Runtime.situation.cars = Runtime.cars;
	Runtime.reInfo.carList = &(Runtime.car);
	Runtime.reInfo.s = &(Runtime.situation);
	Runtime.reInfo.track = Runtime.trackData;

	Runtime.simItf.init(1, Runtime.trackData, 1.0f, 1.0f, 1.0f);
	Runtime.simStarted = 1;
	Runtime.simItf.config(&(Runtime.car), &(Runtime.reInfo));
	Runtime.car.ctrl.gear = 0;
	Runtime.car.ctrl.accelCmd = 0.0f;
	Runtime.car.ctrl.brakeCmd = 0.0f;
	Runtime.car.ctrl.clutchCmd = 1.0f;
	Runtime.active = 1;
	return 0;
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
	if (!Runtime.active) {
		return -1;
	}

	Runtime.car.ctrl.steer = clampControl((tdble)steer, -1.0f, 1.0f);
	Runtime.car.ctrl.accelCmd = clampControl((tdble)accel, 0.0f, 1.0f);
	Runtime.car.ctrl.brakeCmd = clampControl((tdble)brake, 0.0f, 1.0f);
	Runtime.car.ctrl.clutchCmd = clampControl((tdble)clutch, 0.0f, 1.0f);
	Runtime.car.ctrl.gear = gear;
	return 0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_step(double deltaTime)
{
	double remaining;
	double step;

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
		Runtime.simItf.update(&(Runtime.situation), step, -1);
		Runtime.situation.currentTime += step;
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
double
torcs_web_runtime_get_car_x(void)
{
	return Runtime.active ? Runtime.car._pos_X : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_y(void)
{
	return Runtime.active ? Runtime.car._pos_Y : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_z(void)
{
	return Runtime.active ? Runtime.car._pos_Z : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_yaw(void)
{
	return Runtime.active ? Runtime.car._yaw : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_speed(void)
{
	return Runtime.active ? Runtime.car.pub.speed : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_fuel(void)
{
	return Runtime.active ? Runtime.car._fuel : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_dimension_x(void)
{
	return Runtime.active ? Runtime.car._dimension_x : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_dimension_y(void)
{
	return Runtime.active ? Runtime.car._dimension_y : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_dimension_z(void)
{
	return Runtime.active ? Runtime.car._dimension_z : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_corner_x(int cornerIndex)
{
	if (!Runtime.active || cornerIndex < 0 || cornerIndex >= 4) {
		return 0.0;
	}

	return Runtime.car._corner_x(cornerIndex);
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_car_corner_y(int cornerIndex)
{
	if (!Runtime.active || cornerIndex < 0 || cornerIndex >= 4) {
		return 0.0;
	}

	return Runtime.car._corner_y(cornerIndex);
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_engine_rpm(void)
{
	return Runtime.active ? Runtime.car._enginerpm : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_engine_redline(void)
{
	return Runtime.active ? Runtime.car._enginerpmRedLine : 0.0;
}

EMSCRIPTEN_KEEPALIVE
int
torcs_web_runtime_get_gear(void)
{
	return Runtime.active ? Runtime.car._gear : 0;
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_wheel_spin_velocity(int wheelIndex)
{
	if (!Runtime.active || wheelIndex < 0 || wheelIndex >= 4) {
		return 0.0;
	}

	return Runtime.car._wheelSpinVel(wheelIndex);
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_wheel_slip_accel(int wheelIndex)
{
	if (!Runtime.active || wheelIndex < 0 || wheelIndex >= 4) {
		return 0.0;
	}

	return Runtime.car._wheelSlipAccel(wheelIndex);
}

EMSCRIPTEN_KEEPALIVE
double
torcs_web_runtime_get_wheel_slip_side(int wheelIndex)
{
	if (!Runtime.active || wheelIndex < 0 || wheelIndex >= 4) {
		return 0.0;
	}

	return Runtime.car._wheelSlipSide(wheelIndex);
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

}

int
main(int /* argc */, char ** /* argv */)
{
	const int result = torcs_web_probe();
	printf("TORCS web probe: %s\n", result == 0 ? "ok" : "failed");
	return result;
}
