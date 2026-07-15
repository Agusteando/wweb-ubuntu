"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bodyParserConfig = {
    whitelistedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    json: {
        encoding: 'utf-8',
        limit: '10mb',
        strict: true,
        types: ['application/json'],
    },
    form: {
        encoding: 'utf-8',
        limit: '10mb',
        queryString: {},
        convertEmptyStringsToNull: true,
        types: ['application/x-www-form-urlencoded'],
    },
    raw: {
        encoding: 'utf-8',
        limit: '10mb',
        queryString: {},
        types: ['text/*'],
    },
    multipart: {
        autoProcess: true,
        processManually: [],
        encoding: 'utf-8',
        convertEmptyStringsToNull: true,
        maxFields: 1000,
        limit: '20mb',
        types: ['multipart/form-data'],
    },
};
exports.default = bodyParserConfig;
//# sourceMappingURL=bodyparser.js.map