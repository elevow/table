import React from 'react';
import Footer from '../components/footer';
import Header from '../components/header';

export default class Setup extends React.Component {
    render() {
        return (
            <div>
            <Header/>
            <h1>Setup</h1>
            <p>This will be the guide to build games.</p>
            <Footer/>
            </div>
        );
    }
}