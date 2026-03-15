
///////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////
////////////////////////// Campfire scene /////////////////////////////
/////////////////////////// by Maurogik ///////////////////////////////
///////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////

//
// Animated fire scene
// If ran on a laptop, automatically turns it into a nice hand warmer ;)
// The whole fire burns out in about 80 seconds
//
// The fire itself is a deformed SDF rendered as an emissive volumetric effect.
// Several area lights are used for lighting the scene.
// 

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec2 uv = fragCoord.xy / iResolution.xy;
      
	vec4 colour = textureLod(iChannel0, uv, 0.0);
    
    //Shadertoy very conveniently provides us with Mips of the input buffers !
    //Let's do bloom !
    
    float totalWeight = 0.0;
    
    vec3 bloom = oz.yyy;
    
    vec2 subPixelJitter = fract(hash22(fragCoord)
                                + float(iFrame%256) * kGoldenRatio * oz.xx) - 0.5*oz.xx;
    
    float range = 1.0;
    //Super sample low mips to get less blocky bloom
    for(float xo = -range; xo < range + 0.1; xo += 0.5)
    {
        for(float yo = -range; yo < range + 0.1; yo += 0.5)
        {
            vec2 vo = vec2(xo, yo);
            float weight = (range*range*2.0) - dot(vo, vo);
            vo += 0.5 * (subPixelJitter);
            vec2 off = vo*(0.5/range)/iResolution.xy;
            
            if(weight > 0.0)
            {
                bloom += 0.4  * weight * textureLod(iChannel0, uv + off*exp2(4.0), 4.0).rgb;
                bloom += 0.4  * weight * textureLod(iChannel0, uv + off*exp2(5.0), 5.0).rgb;
                bloom += 0.4  * weight * textureLod(iChannel0, uv + off*exp2(6.0), 6.0).rgb;
            }
            totalWeight += weight;
        }
    }

    bloom.rgb /= totalWeight;
    
    colour.rgb += 0.025 * pow(bloom, oz.xxx*2.0);
    
    //Vignette
    colour.rgb *= linearstep(0.8, 0.3, length(uv - 0.5*oz.xx));
        
    colour.rgb = tonemap(colour.rgb);
    
    colour = pow(colour, vec4(1.0/2.2));
    
    //Colour banding removal
    float dithering = hash12(fragCoord) - 0.5;
    fragColor = colour + oz.xxxx * dithering / 255.0;
}