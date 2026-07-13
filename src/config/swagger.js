const swaggerJsdoc = require('swagger-jsdoc');

const swaggerSpec = swaggerJsdoc({
    definition: {
        openapi: '3.0.3',
        info: {
            title: 'WeaveCarbon API',
            version: '1.0.0',
            description: 'Carbon tracking and sustainability management API for WeaveCarbon.'
        },
        servers: [
            {
                url: '/api',
                description: 'Current environment'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT'
                }
            }
        },
        security: [{ bearerAuth: [] }]
    },
    apis: ['./src/routes/*.js']
});

module.exports = swaggerSpec;
