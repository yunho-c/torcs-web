/***************************************************************************

    file                 : torcs_web_platform.h
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

#ifndef _TORCS_WEB_PLATFORM_H_
#define _TORCS_WEB_PLATFORM_H_

#include <tgf.h>

typedef struct TorcsWebModule {
	const char	*name;
	tfModInfo	modInfo;
} tTorcsWebModule;

extern void TorcsWebInitPlatform(const tTorcsWebModule *modules, int moduleCount);

#endif /* _TORCS_WEB_PLATFORM_H_ */
