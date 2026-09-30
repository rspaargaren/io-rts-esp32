# For more information about build system see
# https://docs.espressif.com/projects/esp-idf/en/latest/api-guides/build-system.html
# The following five lines of boilerplate have to be in your project's
# CMakeLists in this exact order for cmake to work correctly
cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
idf_build_set_property(MINIMAL_BUILD ON)

if(DEFINED ENV{APP_VERSION})
    set(PROJECT_VER "$ENV{APP_VERSION}")
elseif(DEFINED APP_VERSION)
    set(PROJECT_VER "${APP_VERSION}")
endif()

project(io-rts-esp32)

# Stamp web UI version into LittleFS so /api/info can report it
file(WRITE ${CMAKE_SOURCE_DIR}/web_data_v2/version.json "{\"version\":\"${PROJECT_VER}\"}\n")

# Stage web assets with CSS/JS replaced by .gz versions (saves ~40 KB on the partition)
set(WEB_STAGED_DIR "${CMAKE_BINARY_DIR}/web_staged")
file(COPY "${CMAKE_SOURCE_DIR}/web_data_v2/dist/" DESTINATION "${WEB_STAGED_DIR}")

find_program(GZIP_EXECUTABLE gzip)
if(GZIP_EXECUTABLE)
    file(GLOB_RECURSE _web_compress
        "${WEB_STAGED_DIR}/*.css"
        "${WEB_STAGED_DIR}/*.js")
    foreach(_f ${_web_compress})
        execute_process(COMMAND "${GZIP_EXECUTABLE}" -9 -f "${_f}")
    endforeach()
    message(STATUS "Staged compressed web assets in ${WEB_STAGED_DIR}")
endif()

littlefs_create_partition_image(web "${WEB_STAGED_DIR}" FLASH_IN_PROJECT)
