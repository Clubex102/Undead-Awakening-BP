export const VECTOR = {
    create (x, y, z) {
        return {x: x, y: y, z:z}
    },
    getMagnitude (vector) { 
        let magnitude = 0
        for (let p in vector) {
            magnitude += Math.pow(vector[p], 2)
        }
        return Math.sqrt(magnitude);
    },
    subtractWithVector(vector1, vector2) {
    let result = {}
    for (let prop in vector1) {
        result[prop] = vector1[prop] - vector2[prop]
    }
    return result;
        
    },
    normalize(vector) {
        let normalized = {};
        let magnitude = 0;
        
        for (let p in vector) {
            magnitude += vector[p] * vector[p];
        }
        
        magnitude = Math.sqrt(magnitude);
        
        if (magnitude === 0) {
            for (let p in vector) {
                normalized[p] = 0;
            }
        } else {
            for (let p in vector) {
                normalized[p] = vector[p] / magnitude;
            }
        }
        
        return normalized;
    },
    addWithVector(vector1, vector2) {
        let result = {};
        
        for (let prop in vector1) {
            result[prop] = vector1[prop] + vector2[prop];
        }
        
        return result;
    },
    multiplyByNum(vector1, num) {
        let result = {};
        
        for (let prop in vector1) {
            result[prop] = vector1[prop] * num;
        }
        
        return result;
    },
    rotateXZ(vector, angleDegrees) {
    const angleRadians = angleDegrees * (Math.PI / 180);
    const cosAngle = Math.cos(angleRadians);
    const sinAngle = Math.sin(angleRadians);

    const { x, y, z } = vector;
    const rotatedX = x * cosAngle - z * sinAngle;
    const rotatedZ = x * sinAngle + z * cosAngle;

    // Rounding to a fixed number of decimal places (e.g., 10 decimal places)
    const roundedX = Math.round(rotatedX * 1e10) / 1e10;
    const roundedZ = Math.round(rotatedZ * 1e10) / 1e10;

    return {
        x: roundedX,
        y: y,
        z: roundedZ
    }
    },
    getPointsOnVector(start, direction, length) {
    let points = [];
    let magnitude = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    let unitDirection = {
        x: direction.x / magnitude,
        y: direction.y / magnitude
    };


    let end = {
        x: start.x + unitDirection.x * length,
        y: start.y + unitDirection.y * length
    };
    let x1 = Math.round(start.x), y1 = Math.round(start.y);
    let x2 = Math.round(end.x), y2 = Math.round(end.y);
    let dx = Math.abs(x2 - x1), sx = x1 < x2 ? 1 : -1;
    let dy = -Math.abs(y2 - y1), sy = y1 < y2 ? 1 : -1;
    let err = dx + dy, e2;

    while (true) {
        points.push({ x: x1, y: y1 });

        if (x1 === x2 && y1 === y2) break;
        e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x1 += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y1 += sy;
        }
    }
    return points;
        
    },
    getXZOrthogonal (vector, direction) {
    return {x: vector.z * (1 * direction), y:0, z: vector.x * (-1 * direction)
    }
},
    rotationToVector(X, Y) {
    const X_rad = Angle.degreesToRadians(X);
    const Y_rad = Angle.degreesToRadians(Y);

    const v_x = Math.cos(Y_rad) * Math.cos(X_rad);
    const v_y = Math.sin(X_rad);
    const v_z = Math.sin(Y_rad) * Math.cos(X_rad);

    return { x: v_x, y: v_y, z: v_z };
},
    rotateVectorByPitch(vector, pitchAngle) {
        const pitchRad = pitchAngle * (Math.PI / 180);
        const cosPitch = Math.cos(pitchRad);
        const sinPitch = Math.sin(pitchRad);
        const newY = vector.y * cosPitch - (Math.sqrt(vector.x * vector.x + vector.z * vector.z)) * sinPitch;
        const newXZMagnitude = vector.y * sinPitch + (Math.sqrt(vector.x * vector.x + vector.z * vector.z)) * cosPitch;
        const originalXZMagnitude = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
        const scale = newXZMagnitude / (originalXZMagnitude || 1); 
        const newX = vector.x * scale;
        const newZ = vector.z * scale;
        const magnitude = Math.sqrt(newX * newX +newY * newY+ newZ * newZ);
        const normalizedVector = {
            x: newX/magnitude,
            y: newY/magnitude,
            z: newZ/magnitude 
        };
        return normalizedVector;
    },
    getAxisRatios(vector) {
        const { x, y, z } = vector;
        const magnitudeSquared = x * x + y * y + z * z;
        const ratioX = x * x / magnitudeSquared;
        const ratioY = y * y / magnitudeSquared;
        const ratioZ = z * z / magnitudeSquared;
        return {
            x: ratioX,
            y: ratioY,
            z: ratioZ
            
        };
        
    },
    getDotProduct(vector1, vector2) {
    let dotProduct = 0;
    for (let prop in vector1) {
        dotProduct += vector1[prop] * vector2[prop]
    }
    return dotProduct;
}
}