export const isFiniteVector = (value, length = null) => (
  (Array.isArray(value) || ArrayBuffer.isView(value))
  && (length == null || value.length === length)
  && [...value].every((entry) => typeof entry === 'number' && Number.isFinite(entry))
);

export function createSeededRandom(seed = 1) {
  let state = 2166136261;
  const text = String(seed);
  for (let index = 0; index < text.length; index += 1) {
    state ^= text.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state |= 0;
    state = state + 0x6D2B79F5 | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function randomNormal(random = Math.random) {
  const left = Math.max(Number.EPSILON, random());
  const right = random();
  return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
}

export function xavierVector(inputWidth, outputWidth, random = Math.random) {
  const width = Math.max(1, Number(inputWidth) + Number(outputWidth));
  const limit = Math.sqrt(6 / width);
  return Array.from(
    { length: Math.max(0, Math.floor(inputWidth * outputWidth)) },
    () => (random() * 2 - 1) * limit,
  );
}

export function dot(left, right) {
  if (left.length !== right.length) throw new RangeError('dot vectors must have equal length');
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result += left[index] * right[index];
  return result;
}

export function dense(input, weights, bias, outputWidth, activation = null) {
  const inputWidth = input.length;
  if (weights.length !== inputWidth * outputWidth || bias.length !== outputWidth) {
    throw new RangeError('dense layer shape mismatch');
  }
  const output = Array(outputWidth).fill(0);
  for (let outputIndex = 0; outputIndex < outputWidth; outputIndex += 1) {
    let value = bias[outputIndex];
    const offset = outputIndex * inputWidth;
    for (let inputIndex = 0; inputIndex < inputWidth; inputIndex += 1) {
      value += weights[offset + inputIndex] * input[inputIndex];
    }
    output[outputIndex] = activation ? activation(value) : value;
  }
  return output;
}

export const sigmoid = (value) => {
  if (value >= 20) return 1;
  if (value <= -20) return 0;
  return 1 / (1 + Math.exp(-value));
};

export const tanh = (value) => Math.tanh(Math.max(-20, Math.min(20, value)));

export function identityMatrix(size, diagonal = 1) {
  const matrix = Array(size * size).fill(0);
  for (let index = 0; index < size; index += 1) matrix[index * size + index] = diagonal;
  return matrix;
}

export function cholesky(matrix, size) {
  if (!isFiniteVector(matrix, size * size)) throw new RangeError('Cholesky matrix shape mismatch');
  const lower = Array(size * size).fill(0);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let sum = matrix[row * size + column];
      for (let inner = 0; inner < column; inner += 1) {
        sum -= lower[row * size + inner] * lower[column * size + inner];
      }
      if (row === column) {
        if (!(sum > 1e-12) || !Number.isFinite(sum)) {
          throw new RangeError('Matrix is not positive definite');
        }
        lower[row * size + column] = Math.sqrt(sum);
      } else {
        lower[row * size + column] = sum / lower[column * size + column];
      }
    }
  }
  return lower;
}

export function solveLower(lower, vector, size) {
  const result = Array(size).fill(0);
  for (let row = 0; row < size; row += 1) {
    let value = vector[row];
    for (let column = 0; column < row; column += 1) {
      value -= lower[row * size + column] * result[column];
    }
    result[row] = value / lower[row * size + row];
  }
  return result;
}

export function solveLowerTranspose(lower, vector, size) {
  const result = Array(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let value = vector[row];
    for (let column = row + 1; column < size; column += 1) {
      value -= lower[column * size + row] * result[column];
    }
    result[row] = value / lower[row * size + row];
  }
  return result;
}

export function solvePositiveDefinite(matrix, vector, size) {
  if (!isFiniteVector(vector, size)) throw new RangeError('solve vector shape mismatch');
  const lower = cholesky(matrix, size);
  return solveLowerTranspose(lower, solveLower(lower, vector, size), size);
}

export function normalizeRepresentation(vector, biasIndex = vector.length - 1) {
  if (!isFiniteVector(vector) || !vector.length) throw new RangeError('representation must be finite');
  const result = [...vector];
  let magnitudeSquared = 0;
  for (let index = 0; index < result.length; index += 1) {
    if (index !== biasIndex) magnitudeSquared += result[index] * result[index];
  }
  const magnitude = Math.sqrt(magnitudeSquared);
  if (magnitude > 1) {
    for (let index = 0; index < result.length; index += 1) {
      if (index !== biasIndex) result[index] /= magnitude;
    }
  }
  if (biasIndex >= 0 && biasIndex < result.length) result[biasIndex] = 1;
  return result;
}
