set -e

./features/scripts/build-common.sh

pushd features/fixtures/test-app

eas build \
  --local \
  -p ios \
  --output output.ipa \
  --non-interactive

popd

mkdir build
mv features/fixtures/test-app/output.ipa build/output.ipa
