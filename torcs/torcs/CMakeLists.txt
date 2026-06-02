cmake_minimum_required(VERSION 3.20)

project(TORCSWebPort LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(TORCS_ROOT "${CMAKE_CURRENT_SOURCE_DIR}")
set(TORCS_GENERATED_INCLUDE_DIR "${CMAKE_CURRENT_BINARY_DIR}/include")
set(TORCS_PLIB_DIR "${TORCS_ROOT}/src/windows/dependencies/vs2022_win32/plib-code-r2173-trunk-vsproj")
set(TORCS_SIMUV2_DIR "${TORCS_ROOT}/src/modules/simu/simuv2")
set(TORCS_SOLID_DIR "${TORCS_SIMUV2_DIR}/SOLID-2.0")

file(MAKE_DIRECTORY "${TORCS_GENERATED_INCLUDE_DIR}/tmath")
foreach(TORCS_MATH_HEADER linalg_t.h straight2_t.h v2_t.h v3_t.h v4_t.h)
	configure_file(
		"${TORCS_ROOT}/src/libs/math/${TORCS_MATH_HEADER}"
		"${TORCS_GENERATED_INCLUDE_DIR}/tmath/${TORCS_MATH_HEADER}"
		COPYONLY
	)
endforeach()

function(torcs_common_includes target)
	target_include_directories(${target}
		PUBLIC
			"${TORCS_GENERATED_INCLUDE_DIR}"
			"${TORCS_ROOT}"
			"${TORCS_ROOT}/src/interfaces"
			"${TORCS_ROOT}/src/libs/portability"
			"${TORCS_ROOT}/src/libs/robottools"
			"${TORCS_ROOT}/src/libs/tgf"
			"${TORCS_ROOT}/src/libs/txml"
			"${TORCS_ROOT}/src/linux"
			"${TORCS_SIMUV2_DIR}"
			"${TORCS_SOLID_DIR}/include"
			"${TORCS_ROOT}/src/windows/include"
	)
	target_compile_definitions(${target} PUBLIC HAVE_CONFIG_H)
endfunction()

add_library(torcs_txml STATIC
	src/libs/txml/xmltok.c
	src/libs/txml/xmlrole.c
	src/libs/txml/xmlparse.c
	src/libs/txml/hashtable.c
	src/libs/txml/xml.cpp
)
torcs_common_includes(torcs_txml)

add_library(torcs_tgf STATIC
	src/libs/tgf/module.cpp
	src/libs/tgf/os.cpp
	src/libs/tgf/params.cpp
	src/libs/tgf/tgf.cpp
	src/libs/tgf/trace.cpp
	src/libs/tgf/directory.cpp
	src/libs/tgf/profiler.cpp
	src/libs/tgf/hash.cpp
)
torcs_common_includes(torcs_tgf)
target_link_libraries(torcs_tgf PUBLIC torcs_txml)

add_library(torcs_robottools STATIC
	src/libs/robottools/rttrack.cpp
)
torcs_common_includes(torcs_robottools)
target_link_libraries(torcs_robottools PUBLIC torcs_tgf)

add_library(torcs_track STATIC
	src/modules/track/track.cpp
	src/modules/track/trackitf.cpp
	src/modules/track/trackutil.cpp
	src/modules/track/track3.cpp
	src/modules/track/track4.cpp
)
torcs_common_includes(torcs_track)
target_link_libraries(torcs_track PUBLIC torcs_tgf torcs_robottools)

add_library(torcs_plibsg STATIC
	src/windows/dependencies/vs2022_win32/plib-code-r2173-trunk-vsproj/src/sg/sg.cxx
)
torcs_common_includes(torcs_plibsg)
target_include_directories(torcs_plibsg
	PUBLIC
		"${TORCS_PLIB_DIR}/src/sg"
		"${TORCS_PLIB_DIR}/src/util"
)

add_library(torcs_solid STATIC
	src/modules/simu/simuv2/SOLID-2.0/src/BBoxTree.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/Box.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/C-api.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/Complex.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/Cone.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/Convex.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/Cylinder.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/Endpoint.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/Object.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/Polygon.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/Polyhedron.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/RespTable.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/Response.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/Simplex.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/Sphere.cpp
	src/modules/simu/simuv2/SOLID-2.0/src/Transform.cpp
)
torcs_common_includes(torcs_solid)

add_library(torcs_simuv2 STATIC
	src/modules/simu/simuv2/aero.cpp
	src/modules/simu/simuv2/atmosphere.cpp
	src/modules/simu/simuv2/axle.cpp
	src/modules/simu/simuv2/brake.cpp
	src/modules/simu/simuv2/car.cpp
	src/modules/simu/simuv2/categories.cpp
	src/modules/simu/simuv2/collide.cpp
	src/modules/simu/simuv2/differential.cpp
	src/modules/simu/simuv2/engine.cpp
	src/modules/simu/simuv2/simu.cpp
	src/modules/simu/simuv2/simuitf.cpp
	src/modules/simu/simuv2/steer.cpp
	src/modules/simu/simuv2/susp.cpp
	src/modules/simu/simuv2/transmission.cpp
	src/modules/simu/simuv2/wheel.cpp
)
torcs_common_includes(torcs_simuv2)
target_link_libraries(torcs_simuv2 PUBLIC torcs_tgf torcs_robottools torcs_plibsg torcs_solid)

add_executable(torcs_web_probe
	src/web/torcs_web_platform.cpp
	src/web/torcs_web_probe.cpp
)
target_link_libraries(torcs_web_probe PRIVATE torcs_tgf torcs_track torcs_simuv2)

if(EMSCRIPTEN)
	set(TORCS_WEB_EXPORTED_FUNCTIONS
		"'_main'"
		"'_torcs_web_probe'"
		"'_torcs_web_get_module_name'"
		"'_torcs_web_get_capture_fps'"
		"'_torcs_web_check_static_module_registry'"
		"'_torcs_web_check_track_module'"
		"'_torcs_web_check_simuv2_module'"
		"'_torcs_web_check_track_build'"
		"'_torcs_web_check_headless_sim_init'"
		"'_torcs_web_check_headless_sim_update'"
		"'_torcs_web_runtime_start'"
		"'_torcs_web_runtime_shutdown'"
		"'_torcs_web_runtime_set_controls'"
		"'_torcs_web_runtime_step'"
		"'_torcs_web_runtime_get_time'"
		"'_torcs_web_runtime_get_car_x'"
		"'_torcs_web_runtime_get_car_y'"
		"'_torcs_web_runtime_get_car_z'"
		"'_torcs_web_runtime_get_car_yaw'"
		"'_torcs_web_runtime_get_car_speed'"
		"'_torcs_web_runtime_get_car_fuel'"
	)
	list(JOIN TORCS_WEB_EXPORTED_FUNCTIONS "," TORCS_WEB_EXPORTED_FUNCTIONS_ARG)

	target_link_options(torcs_web_probe
		PRIVATE
			"--preload-file=${TORCS_ROOT}/src/libs/raceengineclient/raceengine.xml@/torcs/config/raceengine.xml"
			"--preload-file=${TORCS_ROOT}/src/libs/tgf/params.dtd@/torcs/tgf/params.dtd"
			"--preload-file=${TORCS_ROOT}/src/libs/tgf/params.dtd@/torcs/src/libs/tgf/params.dtd"
			"--preload-file=${TORCS_ROOT}/data/tracks/e-track-1/e-track-1.xml@/torcs/data/tracks/e-track-1/e-track-1.xml"
			"--preload-file=${TORCS_ROOT}/data/data/tracks/objects.xml@/torcs/data/tracks/objects.xml"
			"--preload-file=${TORCS_ROOT}/data/data/tracks/surfaces.xml@/torcs/data/tracks/surfaces.xml"
			"--preload-file=${TORCS_ROOT}/data/cars/models/kc-2000gt/kc-2000gt.xml@/torcs/data/cars/models/kc-2000gt/kc-2000gt.xml"
			"-sMODULARIZE=1"
			"-sEXPORT_NAME=TorcsWebProbe"
			"-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
			"-sEXPORTED_FUNCTIONS=[${TORCS_WEB_EXPORTED_FUNCTIONS_ARG}]"
	)
	set_target_properties(torcs_web_probe PROPERTIES SUFFIX ".js")

	find_program(TORCS_NODE_EXECUTABLE node)
	if(TORCS_NODE_EXECUTABLE)
		add_custom_target(torcs_web_probe_smoke
			COMMAND
				"${TORCS_NODE_EXECUTABLE}"
				"${TORCS_ROOT}/src/web/smoke_probe.js"
				"$<TARGET_FILE:torcs_web_probe>"
			WORKING_DIRECTORY "$<TARGET_FILE_DIR:torcs_web_probe>"
			DEPENDS torcs_web_probe
			COMMENT "Running TORCS WASM probe smoke test"
		)
	endif()
endif()
