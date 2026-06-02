/***************************************************************************

    file                 : torcs_web_platform.cpp
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

#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif

#include <tgf.h>

#include "os.h"
#include "torcs_web_platform.h"

static const tTorcsWebModule *WebModules = NULL;
static int WebModuleCount = 0;

static void
getModuleBaseName(const char *path, char *name, size_t nameSize)
{
	const char *base = path;
	const char *slash;
	char *dot;

	if (!path || nameSize == 0) {
		return;
	}

	slash = strrchr(path, '/');
	if (slash) {
		base = slash + 1;
	}

	slash = strrchr(base, '\\');
	if (slash) {
		base = slash + 1;
	}

	strncpy(name, base, nameSize - 1);
	name[nameSize - 1] = '\0';

	dot = strrchr(name, '.');
	if (dot) {
		*dot = '\0';
	}
}

static const tTorcsWebModule *
findModule(const char *path)
{
	char name[256];
	int i;

	name[0] = '\0';
	getModuleBaseName(path, name, sizeof(name));

	for (i = 0; i < WebModuleCount; i++) {
		if (WebModules[i].name && strcmp(WebModules[i].name, name) == 0) {
			return &WebModules[i];
		}
	}

	return NULL;
}

static void
freeModuleNode(tModList *mod)
{
	int i;

	if (!mod) {
		return;
	}

	for (i = 0; i < MAX_MOD_ITF; i++) {
		if (mod->modInfo[i].name) {
			free(mod->modInfo[i].name);
			free(mod->modInfo[i].desc);
		}
	}

	free(mod->sopath);
	free(mod);
}

static void
insertModule(tModList **modlist, tModList *curMod)
{
	tModList *cMod;
	int prio;

	if (*modlist == NULL) {
		*modlist = curMod;
		curMod->next = curMod;
		return;
	}

	prio = curMod->modInfo[0].prio;
	if (prio >= (*modlist)->modInfo[0].prio) {
		curMod->next = (*modlist)->next;
		(*modlist)->next = curMod;
		*modlist = curMod;
		return;
	}

	cMod = *modlist;
	do {
		if (prio < cMod->next->modInfo[0].prio || cMod->next == *modlist) {
			curMod->next = cMod->next;
			cMod->next = curMod;
			return;
		}
		cMod = cMod->next;
	} while (cMod != *modlist);
}

static int
addModule(const tTorcsWebModule *webModule, const char *sopath, tModList **modlist, unsigned int gfid, int checkGfid)
{
	tModList *curMod;

	if (!webModule || !webModule->modInfo || !modlist) {
		return -1;
	}

	curMod = (tModList*)calloc(1, sizeof(tModList));
	if (!curMod) {
		return -1;
	}

	if (webModule->modInfo(curMod->modInfo) != 0) {
		freeModuleNode(curMod);
		return -1;
	}

	if (checkGfid && curMod->modInfo[0].gfId != gfid) {
		freeModuleNode(curMod);
		return 0;
	}

	curMod->handle = NULL;
	curMod->sopath = strdup(sopath ? sopath : webModule->name);
	if (!curMod->sopath) {
		freeModuleNode(curMod);
		return -1;
	}

	insertModule(modlist, curMod);
	return 1;
}

static int
webModLoad(unsigned int gfid, char *sopath, tModList **modlist)
{
	const tTorcsWebModule *webModule = findModule(sopath);
	const int result = addModule(webModule, sopath, modlist, gfid, 0);

	return result < 0 ? -1 : 0;
}

static int
webModInfo(unsigned int gfid, char *sopath, tModList **modlist)
{
	const tTorcsWebModule *webModule = findModule(sopath);
	const int result = addModule(webModule, sopath, modlist, gfid, 0);

	return result < 0 ? -1 : 0;
}

static int
webModLoadDir(unsigned int gfid, char * /* dir */, tModList **modlist)
{
	int i;
	int modnb = 0;

	for (i = 0; i < WebModuleCount; i++) {
		const int result = addModule(&WebModules[i], WebModules[i].name, modlist, gfid, 1);
		if (result < 0) {
			return -1;
		}
		modnb += result;
	}

	return modnb;
}

static int
webModInfoDir(unsigned int /* gfid */, char * /* dir */, int /* level */, tModList **modlist)
{
	int i;
	int modnb = 0;

	for (i = 0; i < WebModuleCount; i++) {
		const int result = addModule(&WebModules[i], WebModules[i].name, modlist, 0, 0);
		if (result < 0) {
			return -1;
		}
		modnb += result;
	}

	return modnb;
}

static int
webModFreeList(tModList **modlist)
{
	tModList *curMod;
	tModList *nextMod;

	if (!modlist || !*modlist) {
		return 0;
	}

	curMod = *modlist;
	nextMod = curMod->next;
	do {
		curMod = nextMod;
		nextMod = curMod->next;
		freeModuleNode(curMod);
	} while (curMod != *modlist);

	*modlist = NULL;
	return 0;
}

static double
webTimeClock(void)
{
#ifdef __EMSCRIPTEN__
	return emscripten_get_now() / 1000.0;
#else
	return (double)clock() / (double)CLOCKS_PER_SEC;
#endif
}

void
TorcsWebInitPlatform(const tTorcsWebModule *modules, int moduleCount)
{
	memset(&GfOs, 0, sizeof(GfOs));

	WebModules = modules;
	WebModuleCount = moduleCount;

	GfOs.modLoad = webModLoad;
	GfOs.modLoadDir = webModLoadDir;
	GfOs.modUnloadList = webModFreeList;
	GfOs.modInfo = webModInfo;
	GfOs.modInfoDir = webModInfoDir;
	GfOs.modFreeInfoList = webModFreeList;
	GfOs.timeClock = webTimeClock;
}
