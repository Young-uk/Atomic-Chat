function notARegularFileMessage(absolute, info) {
  const head = `os.fs.read: ${absolute} is not a regular file`;
  if (info.isDirectory()) {
    return `${head} \u2014 it is a directory. List it with os.fs.list, then read a file inside it.`;
  }
  if (isDevice(absolute, info)) {
    return `${head} \u2014 it is a device, so there is nothing to read. Do not use it as a placeholder: pass the path of a real file, or drop this call.`;
  }
  return `${head} \u2014 it is a socket, pipe or other special file. Pass the path of a regular file.`;
}
function isDevice(absolute, info) {
  return info.isCharacterDevice() || info.isBlockDevice() || absolute === "/dev" || absolute.startsWith("/dev/");
}
export {
  notARegularFileMessage
};
