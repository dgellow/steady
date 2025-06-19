#!/bin/bash

echo -e "\033[1mColor Theme Options for Steady Logger\033[0m\n"

echo -e "\033[1mCurrent (Orange Diagnostics):\033[0m"
echo -e "j/k:nav space/b:page g:jump \033[38;5;208m/:filter(\"400\")\033[0m t:time q:quit"
echo -e "    \033[38;5;208mquery.debug: Unknown parameter\033[0m"
echo -e "01  GET    /simple?debug=1     → \033[33m400 Bad Request\033[0m 2ms\n"

echo -e "\033[1mOption 1 (Cyan Diagnostics):\033[0m"
echo -e "j/k:nav space/b:page g:jump \033[36m/:filter(\"400\")\033[0m t:time q:quit"
echo -e "    \033[36mquery.debug: Unknown parameter\033[0m"
echo -e "01  GET    /simple?debug=1     → \033[33m400 Bad Request\033[0m 2ms\n"

echo -e "\033[1mOption 2 (Magenta Diagnostics):\033[0m"
echo -e "j/k:nav space/b:page g:jump \033[35m/:filter(\"400\")\033[0m t:time q:quit"
echo -e "    \033[35mquery.debug: Unknown parameter\033[0m"
echo -e "01  GET    /simple?debug=1     → \033[33m400 Bad Request\033[0m 2ms\n"

echo -e "\033[1mOption 3 (Bright Blue Diagnostics):\033[0m"
echo -e "j/k:nav space/b:page g:jump \033[94m/:filter(\"400\")\033[0m t:time q:quit"
echo -e "    \033[94mquery.debug: Unknown parameter\033[0m"
echo -e "01  GET    /simple?debug=1     → \033[33m400 Bad Request\033[0m 2ms\n"

echo -e "\033[1mOption 4 (Green Diagnostics):\033[0m"
echo -e "j/k:nav space/b:page g:jump \033[32m/:filter(\"400\")\033[0m t:time q:quit"
echo -e "    \033[32mquery.debug: Unknown parameter\033[0m"
echo -e "01  GET    /simple?debug=1     → \033[33m400 Bad Request\033[0m 2ms\n"

echo -e "\033[1mOption 5 (Bright White Diagnostics):\033[0m"
echo -e "j/k:nav space/b:page g:jump \033[97m/:filter(\"400\")\033[0m t:time q:quit"
echo -e "    \033[97mquery.debug: Unknown parameter\033[0m"
echo -e "01  GET    /simple?debug=1     → \033[33m400 Bad Request\033[0m 2ms\n"

echo -e "\033[1mOption 6 (Light Pink Diagnostics):\033[0m"
echo -e "j/k:nav space/b:page g:jump \033[38;5;217m/:filter(\"400\")\033[0m t:time q:quit"
echo -e "    \033[38;5;217mquery.debug: Unknown parameter\033[0m"
echo -e "01  GET    /simple?debug=1     → \033[33m400 Bad Request\033[0m 2ms\n"

echo -e "\033[1mOption 7 (Pale Rose Diagnostics):\033[0m"
echo -e "j/k:nav space/b:page g:jump \033[38;5;224m/:filter(\"400\")\033[0m t:time q:quit"
echo -e "    \033[38;5;224mquery.debug: Unknown parameter\033[0m"
echo -e "01  GET    /simple?debug=1     → \033[33m400 Bad Request\033[0m 2ms\n"

echo -e "\033[1mOption 8 (Dusty Pink Diagnostics):\033[0m"
echo -e "j/k:nav space/b:page g:jump \033[38;5;181m/:filter(\"400\")\033[0m t:time q:quit"
echo -e "    \033[38;5;181mquery.debug: Unknown parameter\033[0m"
echo -e "01  GET    /simple?debug=1     → \033[33m400 Bad Request\033[0m 2ms\n"

echo -e "\033[1mHTTP Status Colors (unchanged):\033[0m"
echo -e "\033[33m400 Bad Request\033[0m (yellow 4xx)"
echo -e "\033[31m500 Internal Server Error\033[0m (red 5xx)"