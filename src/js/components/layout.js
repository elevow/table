import React from 'react';

import Body from './body';
import Footer from './footer';
import Header from './header';

export default class Layout extends React.Component {
    render() {
        return (
            <div>
                <Header />
                <Body />
                <Footer/>
            </div>
        );
    }
}