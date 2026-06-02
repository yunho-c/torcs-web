cmake_minimum_required(VERSION 3.20)

project(TORCSWebPort LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(TORCS_ROOT "${CMAKE_CURRENT_SOURCE_DIR}")

function(torcs_common_includes target)
	target_include_directories(${target}
		PUBLIC
			"${TORCS_ROOT}"
			"${TORCS_ROOT}/src/interfaces"
			"${TORCS_ROOT}/src/libs/portability"
			"${TORCS_ROOT}/src/libs/tgf"
			"${TORCS_ROOT}/src/libs/txml"
			"${TORCS_ROOT}/src/linux"
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

add_executable(torcs_web_probe
	src/web/torcs_web_platform.cpp
	src/web/torcs_web_probe.cpp
)
target_link_libraries(torcs_web_probe PRIVATE torcs_tgf)

if(EMSCRIPTEN)
	target_link_options(torcs_web_probe
		PRIVATE
			"--preload-file=${TORCS_ROOT}/src/libs/raceengineclient/raceengine.xml@/torcs/config/raceengine.xml"
			"--preload-file=${TORCS_ROOT}/src/libs/tgf/params.dtd@/torcs/tgf/params.dtd"
			"-sMODULARIZE=1"
			"-sEXPORT_NAME=TorcsWebProbe"
			"-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
			"-sEXPORTED_FUNCTIONS=['_main','_torcs_web_probe','_torcs_web_get_module_name','_torcs_web_get_capture_fps','_torcs_web_check_static_module_registry']"
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
