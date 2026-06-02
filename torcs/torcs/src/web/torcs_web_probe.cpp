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

}

int
main(int /* argc */, char ** /* argv */)
{
	const int result = torcs_web_probe();
	printf("TORCS web probe: %s\n", result == 0 ? "ok" : "failed");
	return result;
}
