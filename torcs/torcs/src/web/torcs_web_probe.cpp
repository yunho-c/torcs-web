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

#include "torcs_web_platform.h"

static const char *RaceEngineConfig = "/torcs/config/raceengine.xml";
static const char *ModulesSection = "Modules";
static const char *MovieCaptureSection = "Movie Capture";
static void *RaceEngineHandle = NULL;

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
		{ "web_probe_module", web_probe_module }
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

}

int
main(int /* argc */, char ** /* argv */)
{
	const int result = torcs_web_probe();
	printf("TORCS web probe: %s\n", result == 0 ? "ok" : "failed");
	return result;
}
