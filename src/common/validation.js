const { BadRequestException } = require("@nestjs/common");

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function requirePositiveNumber(value, fieldName) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    throw new BadRequestException(`${fieldName} must be a positive number.`);
  }

  return value;
}

function optionalNonEmptyString(value, fieldName) {
  if (value == null) {
    return null;
  }

  return requireNonEmptyString(value, fieldName);
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${fieldName} must be an array.`);
  }

  return value;
}

module.exports = {
  optionalNonEmptyString,
  requireArray,
  requireNonEmptyString,
  requirePositiveNumber,
};
