// PDF Generation Diagnostic Script
// Copy and paste this entire script into the browser console on the Purchase Order page
// It will test PDF generation and provide detailed error information

(async function() {
  console.log('🔍 Starting PDF Generation Diagnostic...\n');
  
  const results = {
    step1_checkReactPDF: null,
    step2_testPDFFunction: null,
    step3_testSimpleDocument: null,
    step4_testBlobGeneration: null,
    step5_testActualButton: null,
    errors: []
  };

  // Step 1: Check if @react-pdf/renderer can be imported
  console.log('Step 1: Checking if @react-pdf/renderer is available...');
  try {
    const reactPDF = await import('@react-pdf/renderer');
    console.log('✅ @react-pdf/renderer loaded successfully');
    console.log('   Available exports:', Object.keys(reactPDF));
    results.step1_checkReactPDF = { success: true, exports: Object.keys(reactPDF) };
    
    // Step 2: Test pdf() function
    console.log('\nStep 2: Testing pdf() function...');
    if (reactPDF.pdf) {
      console.log('✅ pdf() function is available');
      console.log('   Type:', typeof reactPDF.pdf);
      results.step2_testPDFFunction = { success: true, type: typeof reactPDF.pdf };
    } else {
      console.log('❌ pdf() function is NOT available');
      results.step2_testPDFFunction = { success: false, error: 'pdf function not found' };
      results.errors.push('pdf() function not found in @react-pdf/renderer');
    }

    // Step 3: Test creating a simple document using React.createElement
    console.log('\nStep 3: Testing simple document creation...');
    try {
      // Check if React is available
      if (typeof React === 'undefined') {
        throw new Error('React is not available in global scope');
      }
      
      const { Document, Page, Text } = reactPDF;
      const simpleDoc = React.createElement(Document, {},
        React.createElement(Page, { size: 'A4' },
          React.createElement(Text, {}, 'Test PDF')
        )
      );
      console.log('✅ Simple document created');
      console.log('   Document type:', typeof simpleDoc);
      results.step3_testSimpleDocument = { success: true, docType: typeof simpleDoc };
    } catch (error) {
      console.log('❌ Failed to create simple document:', error);
      console.log('   Error message:', error.message);
      console.log('   Error stack:', error.stack);
      results.step3_testSimpleDocument = { 
        success: false, 
        error: error.message, 
        stack: error.stack 
      };
      results.errors.push(`Simple document creation failed: ${error.message}`);
    }

    // Step 4: Test blob generation with simple document
    console.log('\nStep 4: Testing blob generation...');
    try {
      if (!reactPDF.pdf) {
        throw new Error('pdf() function not available');
      }
      
      if (typeof React === 'undefined') {
        throw new Error('React is not available');
      }
      
      const { Document, Page, Text } = reactPDF;
      const testDoc = React.createElement(Document, {},
        React.createElement(Page, { size: 'A4' },
          React.createElement(Text, {}, 'Test PDF Generation')
        )
      );

      console.log('   Attempting to generate blob...');
      const blob = await reactPDF.pdf(testDoc).toBlob();
      console.log('✅ Blob generated successfully');
      console.log('   Blob size:', blob.size, 'bytes');
      console.log('   Blob type:', blob.type);
      results.step4_testBlobGeneration = { 
        success: true, 
        blobSize: blob.size, 
        blobType: blob.type 
      };
    } catch (error) {
      console.log('❌ Failed to generate blob:', error);
      console.log('   Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      results.step4_testBlobGeneration = { 
        success: false, 
        error: error.message, 
        stack: error.stack,
        name: error.name
      };
      results.errors.push(`Blob generation failed: ${error.message}`);
    }

  } catch (error) {
    console.log('❌ Failed to import @react-pdf/renderer:', error);
    console.log('   Error message:', error.message);
    console.log('   Error stack:', error.stack);
    results.step1_checkReactPDF = { 
      success: false, 
      error: error.message, 
      stack: error.stack 
    };
    results.errors.push(`@react-pdf/renderer import failed: ${error.message}`);
  }

  // Step 5: Try to simulate the actual button click
  console.log('\nStep 5: Testing actual button functionality...');
  try {
    // Find the Print Order button
    const buttons = Array.from(document.querySelectorAll('button'));
    const printButton = buttons.find(btn => 
      btn.textContent?.includes('Print Order') || 
      btn.textContent?.includes('Generating PDF')
    );
    
    if (printButton) {
      console.log('✅ Found Print Order button');
      console.log('   Button disabled:', printButton.disabled);
      console.log('   Button text:', printButton.textContent);
      
      // Check if button is clickable
      if (printButton.disabled) {
        console.log('   ⚠️  Button is disabled (data may not be ready)');
        results.step5_testActualButton = { 
          success: false, 
          reason: 'Button is disabled',
          buttonFound: true 
        };
      } else {
        console.log('   ✅ Button is enabled and clickable');
        results.step5_testActualButton = { 
          success: true, 
          buttonFound: true,
          disabled: false 
        };
      }
    } else {
      console.log('❌ Print Order button not found');
      results.step5_testActualButton = { 
        success: false, 
        reason: 'Button not found',
        buttonFound: false 
      };
    }
  } catch (error) {
    console.log('❌ Error testing button:', error);
    results.step5_testActualButton = { 
      success: false, 
      error: error.message 
    };
  }

  // Final Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 DIAGNOSTIC SUMMARY');
  console.log('='.repeat(60));
  console.log('\nResults:', JSON.stringify(results, null, 2));
  
  if (results.errors.length > 0) {
    console.log('\n❌ ERRORS FOUND:');
    results.errors.forEach((error, index) => {
      console.log(`   ${index + 1}. ${error}`);
    });
  } else {
    console.log('\n✅ All basic tests passed!');
  }

  // Additional environment checks
  console.log('\n' + '='.repeat(60));
  console.log('🔍 Environment Information');
  console.log('='.repeat(60));
  console.log('React available:', typeof React !== 'undefined');
  console.log('React version:', typeof React !== 'undefined' ? React.version : 'N/A');
  console.log('Window location:', window.location.href);
  console.log('User agent:', navigator.userAgent);

  // Return results for further inspection
  window.__PDF_DIAGNOSTIC_RESULTS__ = results;
  console.log('\n💡 Results saved to window.__PDF_DIAGNOSTIC_RESULTS__');
  console.log('   You can inspect it with: console.log(window.__PDF_DIAGNOSTIC_RESULTS__)');
  
  return results;
})();

