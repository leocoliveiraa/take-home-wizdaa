function applyClassDecorators(target, decorators) {
  [...decorators].reverse().forEach((decorator) => decorator(target));
}

function applyMethodDecorators(target, methodName, decorators) {
  const descriptor = Object.getOwnPropertyDescriptor(target.prototype, methodName);

  [...decorators]
    .reverse()
    .forEach((decorator) => decorator(target.prototype, methodName, descriptor));
}

function applyParamDecorators(target, methodName, index, decorators) {
  [...decorators]
    .reverse()
    .forEach((decorator) => decorator(target.prototype, methodName, index));
}

function defineParamTypes(target, paramTypes) {
  Reflect.defineMetadata("design:paramtypes", paramTypes, target);
}

module.exports = {
  applyClassDecorators,
  applyMethodDecorators,
  applyParamDecorators,
  defineParamTypes,
};
