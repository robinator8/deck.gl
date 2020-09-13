import { H3ClusterLayer } from "@deck.gl/geo-layers";
import {CompositeLayer} from '@deck.gl/core';
import * as h3 from 'h3-js';

// h3 hex resolution, larger = smaller-hex
const HEX_RESOLUTION = 7;
// radius of influence for known points (a point can affect a hex this many hexes away)
const INTERPOLATION_RING_SIZE = 12;
// only draw rings that are <= to this distance from some point
const DRAW_RING_SIZE = 6;
// inverse Distance Weighting power function (default=2)
const IDW_POWER = 3;
// the lowest draw confidence (maps to alpha) of a hex
const MIN_CONFIDENCE = .25;
// the radius that confidence stays at 1
const CONFIDENCE_RADIUS = 4;
// the higher the number the steeper the confidence drops as distance increases
const CONFIDENCE_POWER = 1;

export default class HexagonInterpolationLayer extends CompositeLayer {
    renderLayers() {
        const { id, getColor } = this.props;
        const getValue = d => d.value;

        return [
            new H3ClusterLayer({
                id,
                data: this.state.hexData,
                pickable: false,
                stroked: false,
                filled: true,
                extruded: false,
                getHexagons: d => [d.coordinate],
                getFillColor: d =>  {
                    let color = getColor(d, getValue);
                    color.push(d.confidence * 255);
                    return color;
                },
                getLineColor: [255, 255, 255],
                lineWidthMinPixels: 1,
            })

        ];
    }

    updateState({oldProps, props}) {
        if (oldProps.data !== props.data) {
            // data changed, recalculate cluster
            const hexData = this._getHexagonClusterData(props.data, props.getValue, props.getPosition)
            // save processed data to layer state
            this.setState({hexData});
        }
    }

    _getHexagonClusterData(data, getValue, getPosition) {
        let hexData = {};

        data.map(d => {
            const pos = getPosition(d);
            const value = getValue(d);
            const rings = h3.kRingDistances(h3.geoToH3(pos[1], pos[0], HEX_RESOLUTION), INTERPOLATION_RING_SIZE);
            rings.map((ring, distance) => {
                ring.map(h3Pos => {
                    if (hexData[h3Pos] === undefined) {
                        hexData[h3Pos] = {
                            coordinate: h3Pos,
                            info: Array(INTERPOLATION_RING_SIZE + 1)
                        };
                    }
                    if (hexData[h3Pos].info[distance] === undefined) {
                        hexData[h3Pos].info[distance] = []
                    }
                    hexData[h3Pos].info[distance].push(value);
                });
            });
        });

        return Object.values(hexData).map(({ coordinate, info }) => {
            const { value, confidence } = this._calculateValueAndConfidence(info);
            return { value, coordinate, confidence };
        }).filter(({ confidence }) => confidence > 0);
    }

    _calculateValueAndConfidence(info) {

        let numerator = 0.0;
        let denominator = 0.0;
        let minDistance = INTERPOLATION_RING_SIZE + 1;

        info.map((values, distance) => {
            if (values !== undefined && values.length !== 0 && distance < minDistance) {
                minDistance = distance;
            }
            values.map(value => {
                const distanceWeighing = 1.0 / Math.pow(distance + .5, IDW_POWER);
                numerator += value * distanceWeighing;
                denominator += distanceWeighing;
            });
        });

        const confidence = this._calculateConfidence(minDistance);

        const value = numerator / denominator;

        return { value, confidence };
    }

    _calculateConfidence(minDistance){
        if (minDistance > DRAW_RING_SIZE) {
            return -1;
        }
        const linearConfidenceFunction = this._getLinearFunctionFromTwoPoints(
            DRAW_RING_SIZE, Math.pow(MIN_CONFIDENCE, 1/CONFIDENCE_POWER),
            CONFIDENCE_RADIUS, 1)

        const confidenceFunction = x => Math.pow(linearConfidenceFunction(x), CONFIDENCE_POWER);
        const confidence = confidenceFunction(minDistance);
        return confidence;

    }

    _getLinearFunctionFromTwoPoints(x1, y1, x2, y2) {
        const m = (y2 - y1) / (x2 - x1);
        return x => m * (x - x1) + y1;
    }


}

HexagonInterpolationLayer.layerName = 'HexagonInterpolationLayer';