

/**
 * Takes a list of vectors and adds the together
 * @param {Vector3[]} l List of vectors to add together
 * @returns {Vector3}   Result of teh addition of all vectors
 */
export function add(l){

    let r = {x:0,y:0,z:0}
    l.forEach(function(vector){
        r.x = r.x+vector.x
        r.y = r.y+vector.y
        r.z = r.z+vector.z
    })
    return r
}
/**
 * Returns the point product of a * b
 * @param {Vector3} a 
 * @param {Vector3} b 
 * @returns {Vector3} Result of a * b
 */
export function point(a,b){
    return a.x*b.x + a.y*b.y + a.z*b.z
}
/**
 * Returns the cross product of a X b
 * @param {Vector3} a 
 * @param {Vector3} b 
 * @returns {Vector3} Result of a X b
 */
export function cross(a,b){
    return {
        x:(a.y*b.z)-(a.z*b.y),
        y:(a.z*b.x)-(a.x*b.z),
        z:(a.x*b.y)-(a.y*b.x)
    }
}
/**
 * Returns the normalized vector
 * @param {Vector3} v Vector to normilaze
 * @returns {Vector3} Normalized Vector
 */
export function normalize(v) {
    const m = magnitude(v)
    return {x:(v.x/m),y:(v.y/m),z:(v.z/m)}
}

/**
 * Scales a given vector, negative scales invert the direction of the vector 
 * @param {Vector3} v Vector to scale
 * @param {Number} n Scale to be aplied
 * @returns {Vector3} Scaled vector
 */
export function scale(v,n){
    return {x:v.x*n,y:v.y*n,z:v.z*n}
}

/**
 * Returns the magnitude of a given vector
 * @param {Vector3} v 
 * @returns {Vector3} Magnitude of v
 */
export function magnitude (v){
    const {x,y,z} = v
    return Math.sqrt(x*x+y*y+z*z)
}

/**
 * Returns the vector that conects two points, that goes from the origin to the destiny
 * @param  {vector3} origin origin point
 * @param  {vector3} destiny destiny point
 * @returns {vector3} Vector that goes from origin to destiny
 */
export function getDistanceVector(origin,destiny){
    
    return  {x:destiny.x-origin.x,y:destiny.y-origin.y,z:destiny.z-origin.z}
}



export function lCVec(rotation){
    let lz = rotation
    let lx = normalize({x:lz.z,y:0,z:-lz.x})
    let ly = normalize(cross(lz,lx))

    return {vx:lx,vy:ly,vz:lz}
}
/**
 * Transforms local cordinates from a specific local plane/point of view to global cordinates
 * @param {Vector3} origin Origin point of the local plane
 * @param {Vector3} viewDirection Z axis/ View directionof the local plane
 * @param {Vector3} localCoordinates Cordinates on the local plane
 * @returns {Vector3} Equivalent global coordinates
 */
export function localCoordinatesdinatesToGlobal(origin,viewDirection,localCoordinates){
    const {vx,vy,vz} = lCVec(viewDirection)
    const {x,y,z} = localCoordinates

    return add([origin,scale(vx,x),scale(vy,y),scale(vz,z)])
}

/**Transform cartesian into sphere coordinates
 * @param {Vector3} v cartesian coordinates
 * @returns {{rx:number,ry:number,m:number}} x aangle, y angle and magnitude for the corresponding cartisian coordinates
 */
export function cartesianToSphere(v){
    const m = magnitude(v)
    const {x,y,z} = v
    const ry = Math.atan2(z,x) *(180/Math.PI)-90
    const rx = Math.atan2(-y,magnitude({x,y:0,z}))*(180/Math.PI)

    return {rx:rx,ry:ry,m}
}

/**
 * Turns sphere coordinates into cartesian coordinates
 * @param {number} rx x rotation / vertical rotation
 * @param {number} ry y rotation / horizontal rotation
 * @param {number} m magnitude
 * @returns {Vector3} Cartesian coordinates
 */
export function sphereToCartesian(rx,ry,m){
    
    return {x:m*Math.sin(rx)*Math.cos(ry)   ,y:m*Math.cos(rx)  ,z: m*Math.sin(rx)*Math.sin(ry)}
}