#!/bin/bash
set -e

if [ -z "$(which jq)" ]; then
  echo "The 'jq' library is not installed. Please use brew (or your favorite pkg manager) to install 'jq'"
  exit 1
fi

cd "$(dirname $0)"
check_semver="./lib/check_semver.sh"

usage() {
  echo "Usage: ./release.sh -v <version> -n <network>
Create card protocol release to reflect latest deployed version (to be
used after OZ contract upgrade). This will create a version git tag
annotated the with the contract addresses.

-h   Display Help

-n   The network to deploy contracts to (xdai or sokol)

-v   Specify a version which is memorialized as a tag in git and in the package.json
"
}

while getopts "n:v:" options; do
  case "$options" in
  h)
    usage
    exit 0
    ;;
  n)
    network=$OPTARG
    if [ "$network" != "sokol" -a "$network" != "xdai" ]; then
      echo "Must provide valid network to deploy to: 'sokol' or 'xdai'"
      usage
      exit 1
    fi
    ;;
  v)
    version="$($check_semver -v $OPTARG || echo "'${OPTARG}' is not a valid semantic version")"
    if [ "$version" != "$OPTARG" ]; then
      echo "${version}"
      exit 1
    elif [ "$version" == "$(jq -r .version ./package.json)" ]; then
      echo "The version '${version}' is already being used"
      exit 1
    fi
    ;;
  *)
    echo "Unexpected option: $1"
    usage
    exit 1
    ;;
  esac
done

addresses="./.openzeppelin/addresses-${network}.json"
if [ ! -f $addresses ]; then
  echo "Could not find the deployed addresses file: ${addresses}"
  exit 1
fi

tagMessage="Network: $network

$(cat $addresses | jq 'with_entries(.value |= .proxy)')"
echo "$(cat ./package.json | jq ".version = \"${version}\"")" >./package.json
git add ./package.json ./.openzeppelin
git commit -m "v${version}"
git tag -a "v$version" -m "$tagMessage"
git push origin "v${version}"
echo "git tag 'v${version}' created and pushed"
